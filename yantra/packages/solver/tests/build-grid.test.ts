import { describe, expect, it } from 'bun:test';
import { buildSimGrid } from '../src/build-grid';

describe('buildSimGrid', () => {
  it('marks interior voxels as 1 and outside as 0, assigns k', () => {
    const mask = new Uint8Array([0, 1, 1, 0]);
    const g = buildSimGrid(
      { dims: [4, 1, 1], h: 0.01, origin: [0, 0, 0], mask },
      { kVal: 200 },
    );
    expect(Array.from(g.mask)).toEqual([0, 1, 1, 0]);
    expect(g.k[1]).toBe(200);
    expect(g.k[0]).toBe(0);
  });
});
