// A single WebRTC peer relationship: one RTCPeerConnection + one DataChannel.
//
// Convention: the *new arrival* in a room offers; existing peers answer.
// Each peer keeps a single bidirectional 'naadi' DataChannel.

export interface PeerHandlers {
  sendSignal(payload: unknown): void;
  onOpen(): void;
  onMessage(buf: ArrayBuffer): void;
  onClose(): void;
  onError(reason: string): void;
}

export interface PeerOptions {
  iceServers: RTCIceServer[];
  remotePeerId: string;
  role: 'offerer' | 'answerer';
  handlers: PeerHandlers;
}

export class Peer {
  readonly id: string;
  readonly role: 'offerer' | 'answerer';
  private pc: RTCPeerConnection;
  private channel: RTCDataChannel | null = null;
  private handlers: PeerHandlers;
  private destroyed = false;
  private negotiating = false;

  constructor(opts: PeerOptions) {
    this.id = opts.remotePeerId;
    this.role = opts.role;
    this.handlers = opts.handlers;
    this.pc = new RTCPeerConnection({ iceServers: opts.iceServers });

    this.pc.onicecandidate = (ev) => {
      if (ev.candidate) {
        opts.handlers.sendSignal({ type: 'ice', candidate: ev.candidate.toJSON() });
      }
    };
    this.pc.oniceconnectionstatechange = () => {
      const s = this.pc.iceConnectionState;
      if (s === 'failed' || s === 'closed') {
        opts.handlers.onError(`iceConnectionState=${s}`);
      }
    };

    if (opts.role === 'offerer') {
      this.channel = this.pc.createDataChannel('naadi', { ordered: true });
      this.wireChannel(this.channel);
    } else {
      this.pc.ondatachannel = (ev) => {
        this.channel = ev.channel;
        this.wireChannel(this.channel);
      };
    }
  }

  async start(): Promise<void> {
    if (this.role !== 'offerer') return;
    await this.negotiate();
  }

  private async negotiate(): Promise<void> {
    if (this.negotiating || this.destroyed) return;
    this.negotiating = true;
    try {
      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);
      this.handlers.sendSignal({ type: 'sdp', sdp: this.pc.localDescription });
    } catch (e) {
      this.handlers.onError(`offer failed: ${String(e)}`);
    } finally {
      this.negotiating = false;
    }
  }

  async ingestSignal(payload: unknown): Promise<void> {
    if (this.destroyed || !payload || typeof payload !== 'object') return;
    const p = payload as {
      type?: string;
      sdp?: RTCSessionDescriptionInit;
      candidate?: RTCIceCandidateInit;
    };
    try {
      if (p.type === 'sdp' && p.sdp) {
        await this.pc.setRemoteDescription(new RTCSessionDescription(p.sdp));
        if (p.sdp.type === 'offer') {
          const answer = await this.pc.createAnswer();
          await this.pc.setLocalDescription(answer);
          this.handlers.sendSignal({ type: 'sdp', sdp: this.pc.localDescription });
        }
      } else if (p.type === 'ice' && p.candidate) {
        await this.pc.addIceCandidate(new RTCIceCandidate(p.candidate));
      }
    } catch (e) {
      this.handlers.onError(`ingestSignal: ${String(e)}`);
    }
  }

  send(bytes: Uint8Array): boolean {
    if (this.channel?.readyState !== 'open') return false;
    try {
      // RTCDataChannel.send expects ArrayBufferView<ArrayBuffer> in strict TS;
      // the generic Uint8Array<ArrayBufferLike> doesn't satisfy that constraint.
      // Copy into a plain ArrayBuffer-backed view to bridge the type gap.
      const copy = new Uint8Array(bytes.byteLength);
      copy.set(bytes);
      this.channel.send(copy);
      return true;
    } catch (e) {
      this.handlers.onError(`send: ${String(e)}`);
      return false;
    }
  }

  isOpen(): boolean {
    return this.channel?.readyState === 'open';
  }

  destroy(): void {
    this.destroyed = true;
    try {
      this.channel?.close();
    } catch {}
    try {
      this.pc.close();
    } catch {}
    this.channel = null;
  }

  private wireChannel(ch: RTCDataChannel): void {
    ch.binaryType = 'arraybuffer';
    ch.onopen = () => this.handlers.onOpen();
    ch.onmessage = (ev) => {
      if (ev.data instanceof ArrayBuffer) {
        this.handlers.onMessage(ev.data);
      } else if (ev.data instanceof Blob) {
        ev.data.arrayBuffer().then((b) => this.handlers.onMessage(b));
      }
    };
    ch.onclose = () => this.handlers.onClose();
    ch.onerror = (ev) =>
      this.handlers.onError(`dc error: ${(ev as RTCErrorEvent).error?.message ?? 'unknown'}`);
  }
}
