import { describe, expect, it } from 'bun:test';
import { cpuJacobiSolve } from '../src/cpu-jacobi';
import { idx, type SimGrid } from '../src/types';

function bar(Nx: number, kVal: number, Thot: number, Tcold: number): SimGrid {
  const dims: [number, number, number] = [Nx, 1, 1];
  const N = Nx;
  const mask = new Uint8Array(N);
  const T = new Float32Array(N);
  const k = new Float32Array(N).fill(kVal);
  const Q = new Float32Array(N);
  mask[0] = 2;
  T[0] = Thot;
  mask[N - 1] = 2;
  T[N - 1] = Tcold;
  for (let i = 1; i < N - 1; i++) mask[i] = 1;
  return { dims, h: 1 / (N - 1), mask, T, k, Q };
}

describe('cpuJacobiSolve', () => {
  it('1D bar converges to a linear temperature gradient', () => {
    const Nx = 33;
    const Thot = 100;
    const Tcold = 0;
    const g = bar(Nx, 1, Thot, Tcold);
    cpuJacobiSolve(g, { maxIters: 50_000, epsilon: 1e-9 });
    // Jacobi on f32 floors at ~1e-7 relative residual; correctness is the gradient itself.
    for (let i = 0; i < Nx; i++) {
      const expected = Thot + (Tcold - Thot) * (i / (Nx - 1));
      expect(Math.abs(g.T[idx(g.dims, i, 0, 0)]! - expected)).toBeLessThan(5e-3);
    }
  });

  it('insulated voxels keep their initial temperature', () => {
    const Nx = 8;
    const g = bar(Nx, 1, 50, 50);
    for (let i = 1; i < Nx - 1; i++) g.T[i] = 50;
    g.mask[0] = 1;
    g.mask[Nx - 1] = 1;
    const before = Array.from(g.T);
    cpuJacobiSolve(g, { maxIters: 100, epsilon: 1e-9 });
    for (let i = 0; i < Nx; i++) expect(g.T[i]!).toBeCloseTo(before[i]!, 6);
  });
});

describe('cpuJacobiSolve 2D', () => {
  function plate2d(N: number, hotX: number): SimGrid {
    const dims: [number, number, number] = [N, N, 1];
    const M = N * N;
    const mask = new Uint8Array(M);
    const T = new Float32Array(M);
    const k = new Float32Array(M).fill(1);
    const Q = new Float32Array(M);
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) {
        const v = idx(dims, i, j, 0);
        mask[v] = 1;
      }
    for (let i = 0; i < N; i++) {
      mask[idx(dims, i, 0, 0)] = 2;
      T[idx(dims, i, 0, 0)] = 0;
      mask[idx(dims, i, N - 1, 0)] = 2;
      T[idx(dims, i, N - 1, 0)] = 0;
      mask[idx(dims, 0, i, 0)] = 2;
      T[idx(dims, 0, i, 0)] = 0;
      mask[idx(dims, N - 1, i, 0)] = 2;
      T[idx(dims, N - 1, i, 0)] = 0;
    }
    mask[idx(dims, hotX, hotX, 0)] = 2;
    T[idx(dims, hotX, hotX, 0)] = 100;
    return { dims, h: 1 / (N - 1), mask, T, k, Q };
  }

  it('symmetric hot pin gives symmetric solution', () => {
    const N = 17;
    const c = 8;
    const g = plate2d(N, c);
    cpuJacobiSolve(g, { maxIters: 100_000, epsilon: 1e-6 });
    const get = (i: number, j: number): number => g.T[idx(g.dims, i, j, 0)]!;
    for (let i = 1; i < N - 1; i++)
      for (let j = 1; j < N - 1; j++) {
        expect(Math.abs(get(i, j) - get(j, i))).toBeLessThan(1e-3);
        expect(Math.abs(get(i, j) - get(N - 1 - i, j))).toBeLessThan(1e-3);
      }
    expect(get(c, c)).toBeCloseTo(100, 3);
  });
});
