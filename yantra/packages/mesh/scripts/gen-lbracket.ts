// L-bracket — two perpendicular slabs meeting at a corner. The interesting
// physics is the gradient turning the 90° elbow; with BCs at the two distal
// ends you can read off the thermal-resistance penalty of the bend.
import { writeStl, box, type V } from './stl-write';

const tris: V[][] = [];
// Horizontal arm along +X
for (const t of box([0, 0, 0], [1.0, 0.25, 0.25])) tris.push(t);
// Vertical arm along +Z, sharing the (0,0,0)–(0.25,0.25,0.25) corner cube
for (const t of box([0, 0, 0], [0.25, 0.25, 1.0])) tris.push(t);

writeStl(process.argv[2] ?? 'lbracket.stl', tris);
