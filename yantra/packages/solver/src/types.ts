export type Vec3i = readonly [number, number, number];

export type BcKind = 0 | 1 | 2; // 0=outside, 1=interior, 2=Dirichlet

export interface SimGrid {
  dims: Vec3i;
  h: number;
  mask: Uint8Array;
  T: Float32Array;
  k: Float32Array;
  Q: Float32Array;
}

export interface MaterialPreset {
  id: string;
  label: string;
  k: number;
}

export const MATERIALS: readonly MaterialPreset[] = [
  { id: 'copper', label: 'Copper', k: 401 },
  { id: 'aluminum', label: 'Aluminum', k: 237 },
  { id: 'steel', label: 'Steel (1010)', k: 49 },
  { id: 'pla', label: 'PLA plastic', k: 0.13 },
  { id: 'fr4', label: 'FR4 (PCB)', k: 0.3 },
] as const;

export function idx(dims: Vec3i, i: number, j: number, k: number): number {
  return i + dims[0] * (j + dims[1] * k);
}
