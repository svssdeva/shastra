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
  device.queue.writeBuffer(T_a, 0, g.T as unknown as ArrayBuffer);
  const T_b = device.createBuffer({
    size: N * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  });
  device.queue.writeBuffer(T_b, 0, new Float32Array(N) as unknown as ArrayBuffer);

  const kBuf = device.createBuffer({
    size: g.k.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(kBuf, 0, g.k as unknown as ArrayBuffer);
  const qBuf = device.createBuffer({
    size: g.Q.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(qBuf, 0, g.Q as unknown as ArrayBuffer);
  const maskBuf = device.createBuffer({
    size: maskU32.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(maskBuf, 0, maskU32 as unknown as ArrayBuffer);

  const paramsBuf = device.createBuffer({
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(paramsBuf, 0, new Uint32Array([Nx, Ny, Nz]) as unknown as ArrayBuffer);
  device.queue.writeBuffer(paramsBuf, 12, new Float32Array([g.h]) as unknown as ArrayBuffer);

  const resBuf = device.createBuffer({
    size: 8,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  });
  const resReadBuf = device.createBuffer({
    size: 8,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });

  // Reusable readback buffer for full T field (one allocation, reused every readBack call).
  const readBuf = device.createBuffer({
    size: N * 4,
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

  // Pre-create the two ping-pong bind groups once. The previous build created one
  // bind group per Jacobi iteration, which on a 400-batch solve allocates ~80k
  // bind groups and can crash the GPU (GSP / TDR) before convergence.
  const makeJacobiBg = (Tin: GPUBuffer, Tout: GPUBuffer) =>
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
  const bgAB = makeJacobiBg(T_a, T_b);
  const bgBA = makeJacobiBg(T_b, T_a);

  const makeResidualBg = (Ta: GPUBuffer, Tb: GPUBuffer) =>
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
  const rbgAB = makeResidualBg(T_a, T_b);
  const rbgBA = makeResidualBg(T_b, T_a);

  // Parity tracks how many ping-pong swaps have occurred. Even = current is T_a.
  let parity = 0;
  const wgX = Math.ceil(Nx / 8);
  const wgY = Math.ceil(Ny / 8);
  const wgZ = Math.ceil(Nz / 4);
  const wgRes = Math.ceil(N / 64);

  const currentBuf = () => (parity % 2 === 0 ? T_a : T_b);
  const currentBg = () => (parity % 2 === 0 ? bgAB : bgBA);
  const currentResBg = () => (parity % 2 === 0 ? rbgAB : rbgBA);

  let destroyed = false;
  const guard = () => {
    if (destroyed) throw new Error('Pipeline used after destroy()');
  };

  return {
    step(iters: number) {
      guard();
      const enc = device.createCommandEncoder();
      // One pass, alternating bind groups — avoids 2× pass-start cost per iter
      // and avoids re-allocating bind groups inside the hot loop.
      const pass = enc.beginComputePass();
      pass.setPipeline(jacobiPipe);
      for (let i = 0; i < iters; i++) {
        pass.setBindGroup(0, currentBg());
        pass.dispatchWorkgroups(wgX, wgY, wgZ);
        parity++;
      }
      pass.end();
      device.queue.submit([enc.finish()]);
    },
    async computeResidual() {
      guard();
      const enc = device.createCommandEncoder();
      enc.clearBuffer(resBuf, 0, 8);
      const pass = enc.beginComputePass();
      pass.setPipeline(residualPipe);
      pass.setBindGroup(0, currentResBg());
      pass.dispatchWorkgroups(wgRes);
      pass.end();
      enc.copyBufferToBuffer(resBuf, 0, resReadBuf, 0, 8);
      device.queue.submit([enc.finish()]);
      await resReadBuf.mapAsync(GPUMapMode.READ);
      const mapped = resReadBuf.getMappedRange();
      const r = new Uint32Array(mapped.slice(0));
      resReadBuf.unmap();
      const maxDiff = r[0]! / 1e6;
      const maxT = Math.max(r[1]! / 1e6, 1);
      return maxDiff / maxT;
    },
    async readBack() {
      guard();
      const enc = device.createCommandEncoder();
      enc.copyBufferToBuffer(currentBuf(), 0, readBuf, 0, N * 4);
      device.queue.submit([enc.finish()]);
      await readBuf.mapAsync(GPUMapMode.READ);
      const data = new Float32Array(readBuf.getMappedRange().slice(0));
      readBuf.unmap();
      return data;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      T_a.destroy();
      T_b.destroy();
      kBuf.destroy();
      qBuf.destroy();
      maskBuf.destroy();
      paramsBuf.destroy();
      resBuf.destroy();
      resReadBuf.destroy();
      readBuf.destroy();
    },
  };
}
