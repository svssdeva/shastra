const NAME_KEY = 'naadi.name';
const COLOR_KEY = 'naadi.color';

// Pulled from the design.md palette (yellow primary + the named accents).
export const PALETTE = [
  '#faff69', // primary
  '#22c55e', // emerald
  '#3b82f6', // blue
  '#ef4444', // rose
  '#b78cff', // violet
  '#06b6d4', // cyan
  '#f97316', // orange
  '#ec4899', // pink
] as const;

export interface Identity {
  name: string;
  color: string;
}

export function loadIdentity(): Identity | null {
  try {
    const name = localStorage.getItem(NAME_KEY);
    const color = localStorage.getItem(COLOR_KEY);
    if (!name || !color) return null;
    if (!PALETTE.includes(color as (typeof PALETTE)[number])) return null;
    return { name: name.slice(0, 24), color };
  } catch {
    return null;
  }
}

export function saveIdentity(id: Identity): void {
  try {
    localStorage.setItem(NAME_KEY, id.name);
    localStorage.setItem(COLOR_KEY, id.color);
  } catch {}
}

export function randomColor(): string {
  const i = Math.floor(Math.random() * PALETTE.length);
  return PALETTE[i] ?? PALETTE[0];
}
