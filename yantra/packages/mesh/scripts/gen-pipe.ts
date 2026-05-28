// Pipe — hollow cylinder. Outer radius rO, inner radius rI, height h. The
// hollow region voxelizes as outside-mesh, so heat conducts only through the
// pipe wall: the classical concentric-cylinder problem.
import { writeStl, type V } from './stl-write';

function pipe(rO: number, rI: number, h: number, segs: number): V[][] {
  const tris: V[][] = [];
  const oBot: V[] = [];
  const oTop: V[] = [];
  const iBot: V[] = [];
  const iTop: V[] = [];
  for (let i = 0; i < segs; i++) {
    const t = (i / segs) * 2 * Math.PI;
    const c = Math.cos(t);
    const s = Math.sin(t);
    oBot.push([rO * c, rO * s, 0]);
    oTop.push([rO * c, rO * s, h]);
    iBot.push([rI * c, rI * s, 0]);
    iTop.push([rI * c, rI * s, h]);
  }
  // Outer side (normals outward)
  for (let i = 0; i < segs; i++) {
    const j = (i + 1) % segs;
    tris.push([oBot[i]!, oBot[j]!, oTop[j]!]);
    tris.push([oBot[i]!, oTop[j]!, oTop[i]!]);
  }
  // Inner side (normals inward — winding reversed)
  for (let i = 0; i < segs; i++) {
    const j = (i + 1) % segs;
    tris.push([iBot[i]!, iTop[j]!, iBot[j]!]);
    tris.push([iBot[i]!, iTop[i]!, iTop[j]!]);
  }
  // Annular bottom cap (two tris per segment between outer and inner ring)
  for (let i = 0; i < segs; i++) {
    const j = (i + 1) % segs;
    tris.push([oBot[i]!, iBot[i]!, iBot[j]!]);
    tris.push([oBot[i]!, iBot[j]!, oBot[j]!]);
  }
  // Annular top cap
  for (let i = 0; i < segs; i++) {
    const j = (i + 1) % segs;
    tris.push([oTop[i]!, iTop[j]!, iTop[i]!]);
    tris.push([oTop[i]!, oTop[j]!, iTop[j]!]);
  }
  return tris;
}

writeStl(process.argv[2] ?? 'pipe.stl', pipe(0.4, 0.25, 1.0, 48));
