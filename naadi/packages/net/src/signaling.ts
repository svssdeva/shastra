export type ServerToClient =
  | { t: 'peers'; peers: string[] }
  | { t: 'join'; peer: string }
  | { t: 'leave'; peer: string }
  | { t: 'sig'; from: string; payload: unknown };

export type ClientToServer = { t: 'sig'; to: string; payload: unknown };

export interface SignalingOptions {
  url: string;
  room: string;
  peer: string;
  onMessage: (m: ServerToClient) => void;
  onOpen?: () => void;
  onClose?: () => void;
  onError?: (e: Event) => void;
  // Reconnect attempts use exponential backoff between min and max ms.
  reconnectMinMs?: number;
  reconnectMaxMs?: number;
}

export class SignalingClient {
  private opts: SignalingOptions;
  private ws: WebSocket | null = null;
  private destroyed = false;
  private backoff: number;

  constructor(opts: SignalingOptions) {
    this.opts = opts;
    this.backoff = opts.reconnectMinMs ?? 500;
  }

  connect(): void {
    if (this.destroyed) return;
    const url = `${this.opts.url}?room=${encodeURIComponent(this.opts.room)}&peer=${encodeURIComponent(this.opts.peer)}`;
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.onopen = () => {
      this.backoff = this.opts.reconnectMinMs ?? 500;
      this.opts.onOpen?.();
    };
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(
          typeof ev.data === 'string' ? ev.data : new TextDecoder().decode(ev.data as ArrayBuffer),
        ) as ServerToClient;
        this.opts.onMessage(msg);
      } catch (e) {
        console.warn('[naadi/net] bad signaling frame', e);
      }
    };
    ws.onerror = (e) => this.opts.onError?.(e);
    ws.onclose = () => {
      this.opts.onClose?.();
      if (this.destroyed) return;
      const wait = this.backoff;
      this.backoff = Math.min(wait * 2, this.opts.reconnectMaxMs ?? 8000);
      setTimeout(() => this.connect(), wait);
    };
  }

  send(msg: ClientToServer): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  destroy(): void {
    this.destroyed = true;
    try {
      this.ws?.close();
    } catch {}
    this.ws = null;
  }
}
