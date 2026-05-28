/// <reference lib="webworker" />
import { parseStl } from './stl-parse';
import { voxelize } from './voxelize';

export type VoxelizeRequest = { stl: ArrayBuffer; resolution: number };
export type VoxelizeResponse =
  | {
      ok: true;
      dims: [number, number, number];
      h: number;
      origin: [number, number, number];
      mask: ArrayBuffer;
      triCount: number;
    }
  | { ok: false; error: string };

self.onmessage = (e: MessageEvent<VoxelizeRequest>) => {
  try {
    const { stl, resolution } = e.data;
    const tris = parseStl(stl);
    const grid = voxelize(tris, { resolution });
    const resp: VoxelizeResponse = {
      ok: true,
      dims: [...grid.dims] as [number, number, number],
      h: grid.h,
      origin: [...grid.origin] as [number, number, number],
      mask: grid.mask.buffer as ArrayBuffer,
      triCount: tris.length,
    };
    (self as unknown as Worker).postMessage(resp, [grid.mask.buffer as ArrayBuffer]);
  } catch (err) {
    const resp: VoxelizeResponse = {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
    (self as unknown as Worker).postMessage(resp);
  }
};
