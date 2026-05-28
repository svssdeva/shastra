import { idx, type SimGrid } from './types';

export interface JacobiOptions {
  maxIters: number;
  epsilon: number;
  reportEvery?: number;
}

export interface JacobiResult {
  iters: number;
  residual: number;
}

export function cpuJacobiSolve(g: SimGrid, opts: JacobiOptions): JacobiResult {
  const [Nx, Ny, Nz] = g.dims;
  const h2 = g.h * g.h;
  const Tnext = new Float32Array(g.T.length);

  let iter = 0;
  let residual = Infinity;
  for (; iter < opts.maxIters; iter++) {
    let maxDiff = 0;
    let maxT = 0;
    for (let k = 0; k < Nz; k++) {
      for (let j = 0; j < Ny; j++) {
        for (let i = 0; i < Nx; i++) {
          const v = idx(g.dims, i, j, k);
          const m = g.mask[v]!;
          if (m === 0) {
            Tnext[v] = 0;
            continue;
          }
          if (m === 2) {
            Tnext[v] = g.T[v]!;
            continue;
          }
          let num = g.Q[v]! * h2;
          let den = 0;
          const kv = g.k[v]!;
          const tryN = (ni: number, nj: number, nk: number): void => {
            if (ni < 0 || nj < 0 || nk < 0 || ni >= Nx || nj >= Ny || nk >= Nz) return;
            const nv = idx(g.dims, ni, nj, nk);
            if (g.mask[nv] === 0) return;
            const kn = g.k[nv]!;
            const kf = (2 * kv * kn) / (kv + kn + 1e-30);
            num += kf * g.T[nv]!;
            den += kf;
          };
          tryN(i + 1, j, k);
          tryN(i - 1, j, k);
          tryN(i, j + 1, k);
          tryN(i, j - 1, k);
          tryN(i, j, k + 1);
          tryN(i, j, k - 1);
          if (den === 0) {
            Tnext[v] = g.T[v]!;
            continue;
          }
          const tn = num / den;
          Tnext[v] = tn;
          const d = Math.abs(tn - g.T[v]!);
          if (d > maxDiff) maxDiff = d;
          if (Math.abs(tn) > maxT) maxT = Math.abs(tn);
        }
      }
    }
    g.T.set(Tnext);
    residual = maxDiff / Math.max(maxT, 1);
    if (residual < opts.epsilon) {
      iter++;
      break;
    }
  }
  return { iters: iter, residual };
}
