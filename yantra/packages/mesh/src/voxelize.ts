import type { Triangle } from './stl-parse';

export interface VoxelizeOptions {
  resolution: number;
}

export interface VoxelGrid {
  dims: readonly [number, number, number];
  h: number;
  origin: readonly [number, number, number];
  mask: Uint8Array;
}

export function voxelize(tris: Triangle[], opts: VoxelizeOptions): VoxelGrid {
  const { min, max } = bbox(tris);
  const ext: [number, number, number] = [
    max[0] - min[0],
    max[1] - min[1],
    max[2] - min[2],
  ];
  const longest = Math.max(ext[0], ext[1], ext[2]);
  if (longest <= 0) throw new Error('degenerate mesh: zero extent');
  const h = longest / opts.resolution;
  const dims: [number, number, number] = [
    Math.max(1, Math.ceil(ext[0] / h)),
    Math.max(1, Math.ceil(ext[1] / h)),
    Math.max(1, Math.ceil(ext[2] / h)),
  ];
  const mask = new Uint8Array(dims[0] * dims[1] * dims[2]);
  const bins = buildYzBins(tris, min, h, dims);

  for (let k = 0; k < dims[2]; k++) {
    const cz = min[2] + (k + 0.5) * h;
    for (let j = 0; j < dims[1]; j++) {
      const cy = min[1] + (j + 0.5) * h;
      const bucket = bins[j * dims[2] + k];
      if (!bucket || bucket.length === 0) continue;
      for (let i = 0; i < dims[0]; i++) {
        const cx = min[0] + (i + 0.5) * h;
        const crossings = countXCrossings(bucket, tris, cx, cy, cz);
        if ((crossings & 1) === 1) {
          mask[i + dims[0] * (j + dims[1] * k)] = 1;
        }
      }
    }
  }
  return { dims, h, origin: min, mask };
}

function bbox(tris: Triangle[]): {
  min: [number, number, number];
  max: [number, number, number];
} {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const t of tris) {
    for (const v of [t.v0, t.v1, t.v2]) {
      for (let a = 0; a < 3; a++) {
        if (v[a]! < min[a]!) min[a] = v[a]!;
        if (v[a]! > max[a]!) max[a] = v[a]!;
      }
    }
  }
  return { min, max };
}

function buildYzBins(
  tris: Triangle[],
  origin: readonly [number, number, number],
  h: number,
  dims: readonly [number, number, number],
): number[][] {
  const bins: number[][] = new Array(dims[1] * dims[2]);
  for (let t = 0; t < tris.length; t++) {
    const tri = tris[t]!;
    const yLo = Math.min(tri.v0[1], tri.v1[1], tri.v2[1]);
    const yHi = Math.max(tri.v0[1], tri.v1[1], tri.v2[1]);
    const zLo = Math.min(tri.v0[2], tri.v1[2], tri.v2[2]);
    const zHi = Math.max(tri.v0[2], tri.v1[2], tri.v2[2]);
    const j0 = Math.max(0, Math.floor((yLo - origin[1]) / h));
    const j1 = Math.min(dims[1] - 1, Math.floor((yHi - origin[1]) / h));
    const k0 = Math.max(0, Math.floor((zLo - origin[2]) / h));
    const k1 = Math.min(dims[2] - 1, Math.floor((zHi - origin[2]) / h));
    for (let j = j0; j <= j1; j++) {
      for (let k = k0; k <= k1; k++) {
        const key = j * dims[2] + k;
        if (!bins[key]) bins[key] = [];
        bins[key]!.push(t);
      }
    }
  }
  return bins;
}

function countXCrossings(
  bucket: number[],
  tris: Triangle[],
  cx: number,
  cy: number,
  cz: number,
): number {
  let count = 0;
  for (const ti of bucket) {
    const t = tris[ti]!;
    const hit = rayXTriangle(cy, cz, t);
    if (hit !== null && hit > cx) count++;
  }
  return count;
}

function rayXTriangle(cy: number, cz: number, t: Triangle): number | null {
  const ay = t.v0[1];
  const az = t.v0[2];
  const by = t.v1[1];
  const bz = t.v1[2];
  const ccy = t.v2[1];
  const ccz = t.v2[2];
  const v0y = ccy - ay;
  const v0z = ccz - az;
  const v1y = by - ay;
  const v1z = bz - az;
  const v2y = cy - ay;
  const v2z = cz - az;
  const dot00 = v0y * v0y + v0z * v0z;
  const dot01 = v0y * v1y + v0z * v1z;
  const dot02 = v0y * v2y + v0z * v2z;
  const dot11 = v1y * v1y + v1z * v1z;
  const dot12 = v1y * v2y + v1z * v2z;
  const denom = dot00 * dot11 - dot01 * dot01;
  if (denom === 0) return null;
  const inv = 1 / denom;
  const u = (dot11 * dot02 - dot01 * dot12) * inv;
  const v = (dot00 * dot12 - dot01 * dot02) * inv;
  if (u < 0 || v < 0 || u + v > 1) return null;
  const ax = t.v0[0];
  const bx = t.v1[0];
  const ccx = t.v2[0];
  return ax + u * (ccx - ax) + v * (bx - ax);
}
