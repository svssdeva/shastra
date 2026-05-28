import { writeFileSync } from 'node:fs';

type V = [number, number, number];

function sphereTris(r: number, lat: number, lon: number): V[][] {
  const v: V[] = [];
  for (let i = 0; i <= lat; i++) {
    const theta = (i / lat) * Math.PI;
    for (let j = 0; j <= lon; j++) {
      const phi = (j / lon) * 2 * Math.PI;
      v.push([
        r * Math.sin(theta) * Math.cos(phi),
        r * Math.cos(theta),
        r * Math.sin(theta) * Math.sin(phi),
      ]);
    }
  }
  const tris: V[][] = [];
  for (let i = 0; i < lat; i++) {
    for (let j = 0; j < lon; j++) {
      const a = i * (lon + 1) + j;
      const b = a + lon + 1;
      tris.push([v[a]!, v[b]!, v[a + 1]!]);
      tris.push([v[b]!, v[b + 1]!, v[a + 1]!]);
    }
  }
  return tris;
}

const tris = sphereTris(0.5, 24, 48);
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
writeFileSync(process.argv[2] ?? 'sphere.stl', new Uint8Array(buf));
console.log(`wrote ${process.argv[2] ?? 'sphere.stl'}, ${tris.length} tris`);
