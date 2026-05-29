// Stable per-browser peer identity. 16 hex chars (~64 bits) — collision-safe
// for the room-mesh sizes we target (≤ ~8 peers).
const KEY = 'naadi.peerId';

export function getOrCreatePeerId(): string {
  try {
    const existing = localStorage.getItem(KEY);
    if (existing && /^[0-9a-f]{16}$/.test(existing)) return existing;
  } catch {}
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  let id = '';
  for (const b of bytes) id += b.toString(16).padStart(2, '0');
  try {
    localStorage.setItem(KEY, id);
  } catch {}
  return id;
}

export const SIGNAL_URL: string =
  (import.meta.env.PUBLIC_NAADI_SIGNAL_URL as string | undefined) ?? 'ws://localhost:3030/ws';

export function newRoomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return hex;
}
