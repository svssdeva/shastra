import type { VoxelizeRequest, VoxelizeResponse } from './voxelize.worker';

export interface VoxelizeResult {
  dims: [number, number, number];
  h: number;
  origin: [number, number, number];
  mask: Uint8Array;
  triCount: number;
}

export function voxelizeInWorker(
  stl: ArrayBuffer,
  resolution: number,
): Promise<VoxelizeResult> {
  const worker = new Worker(new URL('./voxelize.worker.ts', import.meta.url), {
    type: 'module',
  });
  return new Promise<VoxelizeResult>((resolve, reject) => {
    worker.onmessage = (e: MessageEvent<VoxelizeResponse>) => {
      worker.terminate();
      if (!e.data.ok) {
        reject(new Error(e.data.error));
        return;
      }
      resolve({
        dims: e.data.dims,
        h: e.data.h,
        origin: e.data.origin,
        mask: new Uint8Array(e.data.mask),
        triCount: e.data.triCount,
      });
    };
    worker.onerror = (err) => {
      worker.terminate();
      reject(err);
    };
    const msg: VoxelizeRequest = { stl, resolution };
    worker.postMessage(msg, [stl]);
  });
}
