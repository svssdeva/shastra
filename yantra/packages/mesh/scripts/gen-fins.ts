import { writeFileSync } from 'node:fs';

type V = [number, number, number];

function box(min: V, max: V): V[][] {
  const v = (x: number, y: number, z: number): V => [x, y, z];
  const p000 = v(min[0], min[1], min[2]);
  const p100 = v(max[0], min[1], min[2]);
  const p010 = v(min[0], max[1], min[2]);
  const p110 = v(max[0], max[1], min[2]);
  const p001 = v(min[0], min[1], max[2]);
  const p101 = v(max[0], min[1], max[2]);
  const p011 = v(min[0], max[1], max[2]);
  const p111 = v(max[0], max[1], max[2]);
  return [
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
}

const tris: V[][] = [];
for (const t of box([0, 0, 0], [1, 1, 0.1])) tris.push(t);
for (let i = 0; i < 5; i++) {
  const x0 = 0.1 + i * 0.18;
  for (const t of box([x0, 0, 0.1], [x0 + 0.08, 1, 0.5])) tris.push(t);
}

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
writeFileSync(process.argv[2] ?? 'fins.stl', new Uint8Array(buf));
console.log(`wrote ${process.argv[2] ?? 'fins.stl'}, ${tris.length} tris`);
