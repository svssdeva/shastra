import type { LoroDoc } from 'loro-crdt';
import { decode, encode, type Frame } from './codec';
import { Peer, type PeerHandlers } from './peer';
import { type ServerToClient, SignalingClient } from './signaling';

export interface NetworkOptions {
  signalUrl: string;
  room: string;
  peer: string;
  doc: LoroDoc;
  iceServers?: RTCIceServer[];
  onAwareness?: (peerId: string, payload: unknown) => void;
  onPeerJoin?: (peerId: string) => void;
  onPeerLeave?: (peerId: string) => void;
  onConnectionState?: (state: ConnectionState) => void;
  onLog?: (msg: string) => void;
}

export interface ConnectionState {
  signaling: 'connecting' | 'open' | 'closed';
  openPeers: number;
  knownPeers: number;
}

const DEFAULT_ICE: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];

export class Network {
  private opts: NetworkOptions;
  private signaling: SignalingClient;
  private peers = new Map<string, Peer>();
  private unsubLocal: () => void;
  private destroyed = false;
  private signalingState: 'connecting' | 'open' | 'closed' = 'connecting';

  constructor(opts: NetworkOptions) {
    this.opts = opts;

    this.signaling = new SignalingClient({
      url: opts.signalUrl,
      room: opts.room,
      peer: opts.peer,
      onOpen: () => {
        this.signalingState = 'open';
        this.emitState();
      },
      onClose: () => {
        this.signalingState = 'closed';
        this.emitState();
      },
      onMessage: (m) => this.handleSignal(m),
    });
    this.signaling.connect();

    this.unsubLocal = opts.doc.subscribeLocalUpdates((bytes) => {
      this.broadcast({ kind: 'update', bytes });
    });
  }

  destroy(): void {
    this.destroyed = true;
    this.unsubLocal();
    this.signaling.destroy();
    for (const p of this.peers.values()) p.destroy();
    this.peers.clear();
  }

  peerIds(): string[] {
    return [...this.peers.keys()];
  }

  openPeerIds(): string[] {
    const out: string[] = [];
    for (const [id, p] of this.peers) if (p.isOpen()) out.push(id);
    return out;
  }

  broadcastAwareness(payload: unknown): void {
    this.broadcast({ kind: 'awareness', payload });
  }

  private broadcast(frame: Frame): void {
    const bytes = encode(frame);
    for (const peer of this.peers.values()) {
      if (peer.isOpen()) peer.send(bytes);
    }
  }

  private handleSignal(m: ServerToClient): void {
    switch (m.t) {
      case 'peers':
        // We just joined: offer to every existing peer.
        for (const id of m.peers) this.addPeer(id, 'offerer');
        this.emitState();
        return;
      case 'join':
        // Existing peer in the room sees a new arrival. We answer.
        this.addPeer(m.peer, 'answerer');
        this.emitState();
        return;
      case 'leave': {
        const p = this.peers.get(m.peer);
        if (p) {
          p.destroy();
          this.peers.delete(m.peer);
          this.opts.onPeerLeave?.(m.peer);
          this.emitState();
        }
        return;
      }
      case 'sig': {
        const p = this.peers.get(m.from);
        if (p) void p.ingestSignal(m.payload);
        return;
      }
    }
  }

  private addPeer(remoteId: string, role: 'offerer' | 'answerer'): void {
    if (this.peers.has(remoteId)) return;
    const handlers: PeerHandlers = {
      sendSignal: (payload) => {
        this.signaling.send({ t: 'sig', to: remoteId, payload });
      },
      onOpen: () => {
        this.opts.onLog?.(`peer ${remoteId} channel open`);
        // Send our current snapshot so the remote can fast-forward.
        const snapshot = this.opts.doc.export({ mode: 'snapshot' });
        const peer = this.peers.get(remoteId);
        peer?.send(encode({ kind: 'snapshot', bytes: snapshot }));
        this.opts.onPeerJoin?.(remoteId);
        this.emitState();
      },
      onMessage: (buf) => {
        const frame = decode(buf);
        if (!frame) return;
        switch (frame.kind) {
          case 'snapshot':
          case 'update':
            try {
              this.opts.doc.import(frame.bytes);
            } catch (e) {
              this.opts.onLog?.(`import from ${remoteId} failed: ${String(e)}`);
            }
            return;
          case 'awareness':
            this.opts.onAwareness?.(remoteId, frame.payload);
            return;
        }
      },
      onClose: () => {
        this.opts.onLog?.(`peer ${remoteId} channel closed`);
        this.emitState();
      },
      onError: (reason) => {
        this.opts.onLog?.(`peer ${remoteId}: ${reason}`);
      },
    };
    const peer = new Peer({
      iceServers: this.opts.iceServers ?? DEFAULT_ICE,
      remotePeerId: remoteId,
      role,
      handlers,
    });
    this.peers.set(remoteId, peer);
    void peer.start();
  }

  private emitState(): void {
    if (this.destroyed) return;
    this.opts.onConnectionState?.({
      signaling: this.signalingState,
      openPeers: this.openPeerIds().length,
      knownPeers: this.peers.size,
    });
  }
}

export function startNetwork(opts: NetworkOptions): Network {
  return new Network(opts);
}
