import { describe, expect, it } from 'bun:test';
import { voxelize } from '../src/voxelize';
import type { Triangle } from '../src/stl-parse';

function unitCubeTriangles(): Triangle[] {
  const v = (x: number, y: number, z: number): [number, number, number] => [x, y, z];
  const t = (
    a: [number, number, number],
    b: [number, number, number],
    c: [number, number, number],
  ): Triangle => ({ v0: a, v1: b, v2: c, normal: [0, 0, 0] });
  const p000 = v(0, 0, 0);
  const p100 = v(1, 0, 0);
  const p010 = v(0, 1, 0);
  const p110 = v(1, 1, 0);
  const p001 = v(0, 0, 1);
  const p101 = v(1, 0, 1);
  const p011 = v(0, 1, 1);
  const p111 = v(1, 1, 1);
  return [
    t(p000, p100, p110),
    t(p000, p110, p010),
    t(p001, p111, p101),
    t(p001, p011, p111),
    t(p000, p101, p100),
    t(p000, p001, p101),
    t(p010, p110, p111),
    t(p010, p111, p011),
    t(p000, p011, p001),
    t(p000, p010, p011),
    t(p100, p101, p111),
    t(p100, p111, p110),
  ];
}

describe('voxelize', () => {
  it('a unit cube at 16 resolution gives a mostly-solid 16^3 block', () => {
    const out = voxelize(unitCubeTriangles(), { resolution: 16 });
    expect(out.dims).toEqual([16, 16, 16]);
    const interior = out.mask.reduce((s, vv) => s + (vv === 1 ? 1 : 0), 0);
    expect(interior).toBeGreaterThan(16 * 16 * 16 * 0.85);
  });

  it('respects target resolution along longest axis', () => {
    const tris = unitCubeTriangles();
    const out = voxelize(tris, { resolution: 32 });
    expect(Math.max(...out.dims)).toBe(32);
  });
});
