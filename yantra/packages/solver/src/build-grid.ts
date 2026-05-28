import type { SimGrid } from './types';

export interface BuildGridOpts {
  kVal: number;
}

export function buildSimGrid(
  v: {
    dims: readonly [number, number, number];
    h: number;
    origin: readonly [number, number, number];
    mask: Uint8Array;
  },
  opts: BuildGridOpts,
): SimGrid {
  const N = v.dims[0] * v.dims[1] * v.dims[2];
  const mask = new Uint8Array(v.mask);
  const T = new Float32Array(N);
  const k = new Float32Array(N);
  const Q = new Float32Array(N);
  for (let i = 0; i < N; i++) if (mask[i] === 1) k[i] = opts.kVal;
  return {
    dims: [v.dims[0], v.dims[1], v.dims[2]] as [number, number, number],
    h: v.h,
    mask,
    T,
    k,
    Q,
  };
}
