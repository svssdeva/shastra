import { type ClientToServer, parseRoomQuery, type ServerToClient } from './protocol';

interface SocketData {
  room: string;
  peer: string;
}

const PORT = Number(process.env.PORT ?? 3030);
const IDLE_TIMEOUT_S = 60;

// roomId → peerId → ServerWebSocket
const rooms: Map<string, Map<string, Bun.ServerWebSocket<SocketData>>> = new Map();

function getRoom(id: string): Map<string, Bun.ServerWebSocket<SocketData>> {
  let r = rooms.get(id);
  if (!r) {
    r = new Map();
    rooms.set(id, r);
  }
  return r;
}

function sendTo(ws: Bun.ServerWebSocket<SocketData>, msg: ServerToClient): void {
  try {
    ws.send(JSON.stringify(msg));
  } catch (e) {
    console.warn(`[naadi/signal] send to ${ws.data.peer} failed`, e);
  }
}

function log(action: string, ws: Bun.ServerWebSocket<SocketData> | SocketData, extra = ''): void {
  const data: SocketData = 'data' in ws ? ws.data : ws;
  console.log(
    `[naadi/signal] ${action} room=${data.room.slice(0, 8)} peer=${data.peer} ${extra}`.trim(),
  );
}

const server = Bun.serve<SocketData, never>({
  port: PORT,
  fetch(req, srv) {
    const url = new URL(req.url);

    if (url.pathname === '/health') {
      return new Response(
        JSON.stringify({
          ok: true,
          rooms: rooms.size,
          peers: [...rooms.values()].reduce((n, r) => n + r.size, 0),
        }),
        { headers: { 'content-type': 'application/json' } },
      );
    }

    if (url.pathname === '/ws') {
      const q = parseRoomQuery(url);
      if (!q) {
        return new Response('bad room/peer (expected 32-hex room + 16-hex peer)', { status: 400 });
      }
      const ok = srv.upgrade(req, { data: { room: q.room, peer: q.peer } });
      return ok ? undefined : new Response('upgrade failed', { status: 500 });
    }

    return new Response('naadi signaling — /ws or /health', { status: 404 });
  },
  websocket: {
    idleTimeout: IDLE_TIMEOUT_S,
    open(ws) {
      const room = getRoom(ws.data.room);
      if (room.has(ws.data.peer)) {
        // Same peer ID rejoining (e.g. tab reload) — kick the old one.
        const old = room.get(ws.data.peer);
        if (old && old !== ws) {
          try {
            old.close(1000, 'replaced by newer connection');
          } catch {}
        }
      }
      // Send the new peer the list of existing peers BEFORE adding them.
      const peers = [...room.keys()];
      room.set(ws.data.peer, ws);
      sendTo(ws, { t: 'peers', peers });
      // Notify existing peers about the new arrival.
      const arrival: ServerToClient = { t: 'join', peer: ws.data.peer };
      for (const [id, sock] of room) {
        if (id === ws.data.peer) continue;
        sendTo(sock, arrival);
      }
      log('open', ws, `(${room.size} in room)`);
    },
    message(ws, raw) {
      let msg: ClientToServer;
      try {
        msg = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw));
      } catch {
        return; // ignore malformed
      }
      if (msg.t !== 'sig' || typeof msg.to !== 'string') return;
      const room = rooms.get(ws.data.room);
      if (!room) return;
      const target = room.get(msg.to);
      if (!target) return;
      sendTo(target, { t: 'sig', from: ws.data.peer, payload: msg.payload });
    },
    close(ws) {
      const room = rooms.get(ws.data.room);
      if (!room) return;
      const current = room.get(ws.data.peer);
      // Only remove if this socket is still the live one for that peer ID
      // (avoid race with reload-replacement open()).
      if (current === ws) {
        room.delete(ws.data.peer);
      }
      if (room.size === 0) {
        rooms.delete(ws.data.room);
      } else {
        const dep: ServerToClient = { t: 'leave', peer: ws.data.peer };
        for (const sock of room.values()) sendTo(sock, dep);
      }
      log('close', ws);
    },
  },
});

console.log(
  `[naadi/signal] listening on http://localhost:${server.port}  (ws /ws  health /health)`,
);
