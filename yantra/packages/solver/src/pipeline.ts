import jacobiWgsl from './wgsl/jacobi.wgsl?raw';
import residualWgsl from './wgsl/residual.wgsl?raw';
import type { SimGrid } from './types';

export interface Pipeline {
  step(iters: number): void;
  computeResidual(): Promise<number>;
  readBack(): Promise<Float32Array>;
  destroy(): void;
}

export async function buildPipeline(device: GPUDevice, g: SimGrid): Promise<Pipeline> {
  const [Nx, Ny, Nz] = g.dims;
  const N = Nx * Ny * Nz;

  const maskU32 = new Uint32Array(Math.ceil(N / 4));
  for (let i = 0; i < N; i++) {
    maskU32[Math.floor(i / 4)]! |= g.mask[i]! << ((i % 4) * 8);
  }

  const T_a = device.createBuffer({
    size: N * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  });
  device.queue.writeBuffer(T_a, 0, g.T);
  const T_b = device.createBuffer({
    size: N * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  });
  device.queue.writeBuffer(T_b, 0, new Float32Array(N));

  const kBuf = device.createBuffer({ size: g.k.byteLength, usage: GPUBufferUsage.STORAGE });
  device.queue.writeBuffer(kBuf, 0, g.k);
  const qBuf = device.createBuffer({ size: g.Q.byteLength, usage: GPUBufferUsage.STORAGE });
  device.queue.writeBuffer(qBuf, 0, g.Q);
  const maskBuf = device.createBuffer({
    size: maskU32.byteLength,
    usage: GPUBufferUsage.STORAGE,
  });
  device.queue.writeBuffer(maskBuf, 0, maskU32);

  const paramsBuf = device.createBuffer({
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(paramsBuf, 0, new Uint32Array([Nx, Ny, Nz]));
  device.queue.writeBuffer(paramsBuf, 12, new Float32Array([g.h]));

  const resBuf = device.createBuffer({
    size: 8,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  });
  const resReadBuf = device.createBuffer({
    size: 8,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });

  const jacobiMod = device.createShaderModule({ code: jacobiWgsl });
  const residualMod = device.createShaderModule({ code: residualWgsl });
  const jacobiPipe = device.createComputePipeline({
    layout: 'auto',
    compute: { module: jacobiMod, entryPoint: 'main' },
  });
  const residualPipe = device.createComputePipeline({
    layout: 'auto',
    compute: { module: residualMod, entryPoint: 'main' },
  });

  const jacobiGroupFor = (Tin: GPUBuffer, Tout: GPUBuffer) =>
    device.createBindGroup({
      layout: jacobiPipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: paramsBuf } },
        { binding: 1, resource: { buffer: Tin } },
        { binding: 2, resource: { buffer: Tout } },
        { binding: 3, resource: { buffer: maskBuf } },
        { binding: 4, resource: { buffer: kBuf } },
        { binding: 5, resource: { buffer: qBuf } },
      ],
    });
  const residualGroupFor = (Ta: GPUBuffer, Tb: GPUBuffer) =>
    device.createBindGroup({
      layout: residualPipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: paramsBuf } },
        { binding: 1, resource: { buffer: Ta } },
        { binding: 2, resource: { buffer: Tb } },
        { binding: 3, resource: { buffer: resBuf } },
        { binding: 4, resource: { buffer: maskBuf } },
      ],
    });

  let cur = T_a;
  let nxt = T_b;
  const wgX = Math.ceil(Nx / 8);
  const wgY = Math.ceil(Ny / 8);
  const wgZ = Math.ceil(Nz / 4);
  const wgRes = Math.ceil(N / 64);

  return {
    step(iters: number) {
      const enc = device.createCommandEncoder();
      for (let i = 0; i < iters; i++) {
        const pass = enc.beginComputePass();
        pass.setPipeline(jacobiPipe);
        pass.setBindGroup(0, jacobiGroupFor(cur, nxt));
        pass.dispatchWorkgroups(wgX, wgY, wgZ);
        pass.end();
        const tmp = cur;
        cur = nxt;
        nxt = tmp;
      }
      device.queue.submit([enc.finish()]);
    },
    async computeResidual() {
      const enc = device.createCommandEncoder();
      enc.clearBuffer(resBuf, 0, 8);
      const pass = enc.beginComputePass();
      pass.setPipeline(residualPipe);
      pass.setBindGroup(0, residualGroupFor(cur, nxt));
      pass.dispatchWorkgroups(wgRes);
      pass.end();
      enc.copyBufferToBuffer(resBuf, 0, resReadBuf, 0, 8);
      device.queue.submit([enc.finish()]);
      await resReadBuf.mapAsync(GPUMapMode.READ);
      const r = new Uint32Array(resReadBuf.getMappedRange().slice(0));
      resReadBuf.unmap();
      const maxDiff = r[0]! / 1e6;
      const maxT = Math.max(r[1]! / 1e6, 1);
      return maxDiff / maxT;
    },
    async readBack() {
      const out = device.createBuffer({
        size: N * 4,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
      const enc = device.createCommandEncoder();
      enc.copyBufferToBuffer(cur, 0, out, 0, N * 4);
      device.queue.submit([enc.finish()]);
      await out.mapAsync(GPUMapMode.READ);
      const data = new Float32Array(out.getMappedRange().slice(0));
      out.unmap();
      out.destroy();
      return data;
    },
    destroy() {
      T_a.destroy();
      T_b.destroy();
      kBuf.destroy();
      qBuf.destroy();
      maskBuf.destroy();
      paramsBuf.destroy();
      resBuf.destroy();
      resReadBuf.destroy();
    },
  };
}
