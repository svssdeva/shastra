import { writeFileSync } from 'node:fs';

type V = [number, number, number];
const v = (x: number, y: number, z: number): V => [x, y, z];
const p000 = v(0, 0, 0);
const p100 = v(1, 0, 0);
const p010 = v(0, 1, 0);
const p110 = v(1, 1, 0);
const p001 = v(0, 0, 1);
const p101 = v(1, 0, 1);
const p011 = v(0, 1, 1);
const p111 = v(1, 1, 1);
const tris: V[][] = [
  [p000, p100, p110],
  [p000, p110, p010],
  [p001, p111, p101],
  [p001, p011, p111],
  [p000, p101, p100],
  [p000, p001, p101],
  [p010, p110, p111],
  [p010, p111, p011],
  [p000, p011, p001],
  [p000, p010, p011],
  [p100, p101, p111],
  [p100, p111, p110],
];

const buf = new ArrayBuffer(80 + 4 + 50 * tris.length);
const dv = new DataView(buf);
dv.setUint32(80, tris.length, true);
let o = 84;
for (const t of tris) {
  for (let i = 0; i < 12; i++) dv.setFloat32(o + i * 4, 0, true);
  for (let i = 0; i < 3; i++) {
    dv.setFloat32(o + 12 + i * 12 + 0, t[i]![0], true);
    dv.setFloat32(o + 12 + i * 12 + 4, t[i]![1], true);
    dv.setFloat32(o + 12 + i * 12 + 8, t[i]![2], true);
  }
  dv.setUint16(o + 48, 0, true);
  o += 50;
}

const out = process.argv[2] ?? 'cube.stl';
writeFileSync(out, new Uint8Array(buf));
console.log(`wrote ${out}, ${tris.length} triangles, ${buf.byteLength} bytes`);
