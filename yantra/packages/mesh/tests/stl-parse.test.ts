import { describe, expect, it } from 'bun:test';
import { parseStl } from '../src/stl-parse';

function binaryStlOneTriangle(): ArrayBuffer {
  const buf = new ArrayBuffer(80 + 4 + 50);
  const dv = new DataView(buf);
  dv.setUint32(80, 1, true);
  dv.setFloat32(84, 0, true);
  dv.setFloat32(88, 0, true);
  dv.setFloat32(92, 1, true);
  dv.setFloat32(96, 0, true);
  dv.setFloat32(100, 0, true);
  dv.setFloat32(104, 0, true);
  dv.setFloat32(108, 1, true);
  dv.setFloat32(112, 0, true);
  dv.setFloat32(116, 0, true);
  dv.setFloat32(120, 0, true);
  dv.setFloat32(124, 1, true);
  dv.setFloat32(128, 0, true);
  dv.setUint16(132, 0, true);
  return buf;
}

describe('parseStl', () => {
  it('parses a single-triangle binary STL', () => {
    const tris = parseStl(binaryStlOneTriangle());
    expect(tris.length).toBe(1);
    expect(tris[0]!.v0).toEqual([0, 0, 0]);
    expect(tris[0]!.v1).toEqual([1, 0, 0]);
    expect(tris[0]!.v2).toEqual([0, 1, 0]);
    expect(tris[0]!.normal).toEqual([0, 0, 1]);
  });

  it('parses ASCII STL', () => {
    const ascii = `solid test
facet normal 0 0 1
  outer loop
    vertex 0 0 0
    vertex 1 0 0
    vertex 0 1 0
  endloop
endfacet
endsolid test`;
    const buf = new TextEncoder().encode(ascii).buffer as ArrayBuffer;
    const tris = parseStl(buf);
    expect(tris.length).toBe(1);
    expect(tris[0]!.v1).toEqual([1, 0, 0]);
  });

  it('throws on empty buffer', () => {
    expect(() => parseStl(new ArrayBuffer(0))).toThrow();
  });
});
