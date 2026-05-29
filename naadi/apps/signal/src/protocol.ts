// Wire protocol between browser and signaling server.
// Server is dumb: it only routes envelopes between sockets in the same room.
// SDP / ICE payloads are opaque blobs to the server.

export type ServerToClient =
  | { t: 'peers'; peers: string[] }
  | { t: 'join'; peer: string }
  | { t: 'leave'; peer: string }
  | { t: 'sig'; from: string; payload: unknown };

export type ClientToServer = { t: 'sig'; to: string; payload: unknown };

export interface RoomQuery {
  room: string;
  peer: string;
}

const ROOM_RE = /^[0-9a-f]{32}$/;
const PEER_RE = /^[0-9a-f]{16}$/;

export function parseRoomQuery(url: URL): RoomQuery | null {
  const room = url.searchParams.get('room');
  const peer = url.searchParams.get('peer');
  if (!room || !peer) return null;
  if (!ROOM_RE.test(room)) return null;
  if (!PEER_RE.test(peer)) return null;
  return { room, peer };
}
