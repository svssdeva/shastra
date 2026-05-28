// Square pyramid with apex on +Z. Cross-sectional area shrinks linearly with
// height, so a fixed-T base + fixed-T apex problem develops the textbook
// "tapered conductor" steepening gradient near the apex.
import { writeStl, type V } from './stl-write';

function pyramid(base: number, height: number): V[][] {
  const h = base / 2;
  const p1: V = [-h, -h, 0];
  const p2: V = [h, -h, 0];
  const p3: V = [h, h, 0];
  const p4: V = [-h, h, 0];
  const apex: V = [0, 0, height];
  return [
    // Base, normal -Z
    [p1, p3, p2],
    [p1, p4, p3],
    // 4 triangular sides
    [p1, p2, apex],
    [p2, p3, apex],
    [p3, p4, apex],
    [p4, p1, apex],
  ];
}

writeStl(process.argv[2] ?? 'pyramid.stl', pyramid(1.0, 1.0));
