// Cylinder along the +Z axis. Heat from one end-cap to the other is the
// classic 1-D rod problem; with side-face BCs you get a radial gradient.
import { writeStl, type V } from './stl-write';

function cylinder(r: number, h: number, segs: number): V[][] {
  const tris: V[][] = [];
  const bot: V[] = [];
  const top: V[] = [];
  for (let i = 0; i < segs; i++) {
    const t = (i / segs) * 2 * Math.PI;
    bot.push([r * Math.cos(t), r * Math.sin(t), 0]);
    top.push([r * Math.cos(t), r * Math.sin(t), h]);
  }
  for (let i = 0; i < segs; i++) {
    const j = (i + 1) % segs;
    tris.push([bot[i]!, bot[j]!, top[j]!]);
    tris.push([bot[i]!, top[j]!, top[i]!]);
  }
  const cBot: V = [0, 0, 0];
  const cTop: V = [0, 0, h];
  for (let i = 0; i < segs; i++) {
    const j = (i + 1) % segs;
    tris.push([cBot, bot[j]!, bot[i]!]);
    tris.push([cTop, top[i]!, top[j]!]);
  }
  return tris;
}

writeStl(process.argv[2] ?? 'cylinder.stl', cylinder(0.3, 1.0, 48));
