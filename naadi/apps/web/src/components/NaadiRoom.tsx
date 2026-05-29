import {
  bindPersistence,
  createDoc,
  loadSnapshot,
  loroExtension,
  type NaadiDoc,
  type PersistenceHandle,
  saveSnapshotBytes,
  seedIfEmpty,
} from '@naadi/doc';
import { type CompileDiagnostic, DEFAULT_WGSL, PRESETS } from '@naadi/gpu';
import { type ConnectionState, Network } from '@naadi/net';
import type { JSX } from 'preact';
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { type Identity, loadIdentity, saveIdentity } from '../lib/identity';
import { getOrCreatePeerId, newRoomId, SIGNAL_URL } from '../lib/peer-id';
import type { LocalCursorEvent, RemotePresence } from './awareness-ext';
import Canvas from './Canvas';
import Editor from './Editor';
import NicknameModal from './NicknameModal';
import PresenceRail, { type PeerEntry } from './PresenceRail';

type Hydration =
  | { state: 'loading' }
  | { state: 'ready'; restored: boolean }
  | { state: 'failed'; reason: string };

interface AwarenessPayload {
  name: string;
  color: string;
  from: number;
  to: number;
}

const AWARENESS_THROTTLE_MS = 50;

function PresetPicker({ onLoad }: { onLoad: (id: string) => void }): JSX.Element {
  return (
    <label class="inline-flex items-center" title="Replace the shader with a preset">
      <select
        class="badge-pill text-xs font-[var(--font-mono)]"
        style={
          'appearance: none; -webkit-appearance: none; -moz-appearance: none; ' +
          'cursor: pointer; border-color: var(--color-hairline-strong); ' +
          'background-image: linear-gradient(45deg, transparent 50%, var(--color-muted) 50%), ' +
          '  linear-gradient(135deg, var(--color-muted) 50%, transparent 50%); ' +
          'background-position: calc(100% - 12px) 50%, calc(100% - 7px) 50%; ' +
          'background-size: 5px 5px, 5px 5px; ' +
          'background-repeat: no-repeat; ' +
          'padding-right: 22px;'
        }
        onChange={(e) => {
          const v = (e.currentTarget as HTMLSelectElement).value;
          if (v) onLoad(v);
          (e.currentTarget as HTMLSelectElement).selectedIndex = 0;
        }}
      >
        <option value="">Preset…</option>
        {PRESETS.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function readRoomFromHash(): string | null {
  if (typeof window === 'undefined') return null;
  const m = window.location.hash.match(/^#([0-9a-f]{32})$/);
  return m ? (m[1] ?? null) : null;
}

export default function NaadiRoom(): JSX.Element {
  // Pulled from window.location.hash on mount; null means "redirect to /".
  // We snapshot it once — switching rooms uses a full reload (see hashchange
  // listener below) so the doc/network/IDB binding cleanly resets.
  const [room] = useState<string | null>(() => readRoomFromHash());

  useEffect(() => {
    if (!room) {
      // Bad/missing hash → bounce to landing.
      window.location.replace('/');
      return;
    }
    const onHashChange = () => {
      const next = readRoomFromHash();
      if (next !== room) window.location.reload();
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [room]);

  const naadiRef = useRef<NaadiDoc | null>(null);
  if (naadiRef.current === null) naadiRef.current = createDoc();
  const naadi = naadiRef.current;

  const peerIdRef = useRef<string | null>(null);
  if (peerIdRef.current === null) peerIdRef.current = getOrCreatePeerId();
  const peerId = peerIdRef.current;

  const [identity, setIdentity] = useState<Identity | null>(() => loadIdentity());
  const [hydration, setHydration] = useState<Hydration>({ state: 'loading' });
  const [source, setSource] = useState<string>('');
  const [diags, setDiags] = useState<CompileDiagnostic[]>([]);
  const [conn, setConn] = useState<ConnectionState>({
    signaling: 'connecting',
    openPeers: 0,
    knownPeers: 0,
  });
  const [awareness, setAwareness] = useState<Map<string, AwarenessPayload>>(new Map());
  const [zoom, setZoom] = useState<number>(1);

  const networkRef = useRef<Network | null>(null);
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const lastAwareSentRef = useRef<{ ts: number; from: number; to: number } | null>(null);

  const onDiagnostics = useCallback((d: CompileDiagnostic[]) => setDiags(d), []);

  const extraExtensions = useMemo(() => [loroExtension(naadi.doc, naadi.text)], [naadi]);

  const onLocalCursor = useCallback((e: LocalCursorEvent) => {
    const net = networkRef.current;
    const id = identityRef.current;
    if (!net || !id) return;
    const now = performance.now();
    const last = lastAwareSentRef.current;
    if (last && now - last.ts < AWARENESS_THROTTLE_MS && last.from === e.from && last.to === e.to) {
      return;
    }
    lastAwareSentRef.current = { ts: now, from: e.from, to: e.to };
    const payload: AwarenessPayload = { name: id.name, color: id.color, from: e.from, to: e.to };
    net.broadcastAwareness(payload);
  }, []);

  // Mount: hydrate doc + start network. Skipped if we're about to redirect.
  useEffect(() => {
    if (!room) return;
    let cancelled = false;
    let persistence: PersistenceHandle | null = null;
    let network: Network | null = null;

    (async () => {
      const restored = await loadSnapshot(naadi.doc, room);
      if (cancelled) return;
      seedIfEmpty(naadi, DEFAULT_WGSL);
      setSource(naadi.text.toString());
      setHydration({ state: 'ready', restored });
      persistence = bindPersistence(naadi.doc, room);

      // Helper: broadcast our identity once. Used after network start (in
      // case identity was already loaded from localStorage at mount, racing
      // ahead of the network init) and on every peer-join (so newly arriving
      // peers learn who we are even if our cursor never moves).
      const broadcastSelf = () => {
        const id = identityRef.current;
        const net = networkRef.current;
        if (!id || !net) return;
        net.broadcastAwareness({
          name: id.name,
          color: id.color,
          from: 0,
          to: 0,
        });
      };

      network = new Network({
        signalUrl: SIGNAL_URL,
        room,
        peer: peerId,
        doc: naadi.doc,
        onConnectionState: (s) => {
          if (!cancelled) setConn(s);
        },
        onAwareness: (remotePeerId, payload) => {
          if (cancelled) return;
          if (!isAwarenessPayload(payload)) return;
          setAwareness((prev) => {
            const next = new Map(prev);
            next.set(remotePeerId, payload);
            return next;
          });
        },
        onPeerJoin: () => {
          if (cancelled) return;
          // A peer's DataChannel just opened — tell them who we are.
          broadcastSelf();
        },
        onPeerLeave: (remotePeerId) => {
          if (cancelled) return;
          setAwareness((prev) => {
            if (!prev.has(remotePeerId)) return prev;
            const next = new Map(prev);
            next.delete(remotePeerId);
            return next;
          });
        },
      });
      networkRef.current = network;
      // Immediate broadcast — may go to zero peers right now, but if any
      // DataChannel is already open by the time the identity effect runs,
      // this guarantees the existing peer sees us without waiting on cursor
      // movement.
      broadcastSelf();
    })().catch((e) => {
      if (cancelled) return;
      setHydration({ state: 'failed', reason: String(e) });
    });

    const unsubscribe = naadi.doc.subscribe(() => {
      if (cancelled) return;
      setSource(naadi.text.toString());
    });

    return () => {
      cancelled = true;
      unsubscribe();
      network?.destroy();
      networkRef.current = null;
      void persistence?.flush();
      persistence?.destroy();
    };
  }, [naadi, room, peerId]);

  // When identity becomes known (or changes), re-broadcast our awareness so
  // peers learn our name + color even if we haven't moved the cursor yet.
  useEffect(() => {
    if (!identity) return;
    const net = networkRef.current;
    if (!net) return;
    net.broadcastAwareness({ name: identity.name, color: identity.color, from: 0, to: 0 });
  }, [identity]);

  const remotePresences: RemotePresence[] = useMemo(() => {
    const out: RemotePresence[] = [];
    for (const [pid, a] of awareness) {
      if (pid === peerId) continue;
      out.push({ peerId: pid, name: a.name, color: a.color, from: a.from, to: a.to });
    }
    return out;
  }, [awareness, peerId]);

  const peerEntries: PeerEntry[] = useMemo(
    () => remotePresences.map((p) => ({ peerId: p.peerId, name: p.name, color: p.color })),
    [remotePresences],
  );

  const onSaveIdentity = useCallback((id: Identity) => {
    saveIdentity(id);
    setIdentity(id);
  }, []);

  const onLoadPreset = useCallback(
    (id: string) => {
      const preset = PRESETS.find((p) => p.id === id);
      if (!preset) return;
      // Replace the entire shader doc through Loro so peers see the swap.
      // Delete-then-insert is two ops, but at shader sizes it's fine and
      // the CRDT broadcasts a single update.
      const len = naadi.text.length;
      if (len > 0) naadi.text.delete(0, len);
      naadi.text.insert(0, preset.source);
      naadi.doc.commit();
      setZoom(1);
    },
    [naadi],
  );

  const onFork = useCallback(async () => {
    const snapshot = naadi.doc.export({ mode: 'snapshot' });
    const newId = newRoomId();
    try {
      await saveSnapshotBytes(newId, snapshot);
    } catch (e) {
      console.warn('[naadi] fork failed to persist snapshot', e);
    }
    // Fragment-based room URL. Setting the hash fires hashchange which the
    // listener above turns into a full reload, so the doc/network reset
    // cleanly without us having to teardown manually here.
    window.location.assign(`/r#${newId}`);
  }, [naadi]);

  if (!room) {
    return (
      <div class="h-[calc(100vh-64px)] flex items-center justify-center text-[var(--color-muted)] text-sm">
        no room id in url — redirecting…
      </div>
    );
  }

  // The nickname modal overlays the room shell so the user can see what they
  // are entering — and so the modal sits inside a populated page rather than
  // floating in empty black canvas.
  return (
    <>
      <main class="grid grid-cols-1 md:grid-cols-[1fr_1fr_200px] h-[calc(100vh-64px)]">
        <section
          class="flex flex-col border-r min-h-0"
          style="border-color: var(--color-hairline);"
        >
          <div
            class="flex items-center justify-between px-6 py-3 border-b shrink-0"
            style="border-color: var(--color-hairline);"
          >
            <span class="caption-uppercase">Editor</span>
            <div class="flex items-center gap-2">
              <PresetPicker onLoad={onLoadPreset} />
              <button
                type="button"
                class="badge-pill text-xs font-[var(--font-mono)]"
                style="cursor: pointer; border-color: var(--color-hairline-strong);"
                onClick={() => {
                  void onFork();
                }}
                title="Snapshot the current shader to a new room"
              >
                Fork →
              </button>
              <ConnBadge conn={conn} />
              <HydrationBadge hydration={hydration} />
            </div>
          </div>
          <div class="flex-1 min-h-0 overflow-hidden">
            {hydration.state === 'ready' ? (
              <Editor
                text={naadi.text}
                extraExtensions={extraExtensions}
                remotePresences={remotePresences}
                onLocalCursor={onLocalCursor}
              />
            ) : (
              <div class="h-full flex items-center justify-center text-[var(--color-muted)] text-sm">
                {hydration.state === 'loading' ? 'loading room…' : `failed: ${hydration.reason}`}
              </div>
            )}
          </div>
          <DiagPanel diags={diags} />
        </section>
        <section class="flex flex-col min-h-0" style="background: var(--color-canvas);">
          <div
            class="flex items-center justify-between px-6 py-3 border-b shrink-0"
            style="border-color: var(--color-hairline);"
          >
            <span class="caption-uppercase">Canvas</span>
            <label
              class="flex items-center gap-2 text-xs font-[var(--font-mono)]"
              style="color: var(--color-muted);"
              title="Zoom (scales u.zoom uniform — 3D presets use it for FOV/camera distance)"
            >
              <span>zoom</span>
              <input
                type="range"
                min="0.3"
                max="3"
                step="0.05"
                value={String(zoom)}
                onInput={(e) => setZoom(Number((e.currentTarget as HTMLInputElement).value))}
                style="width: 96px; accent-color: var(--color-primary);"
              />
              <span style="min-width: 2.5em; text-align: right;">{zoom.toFixed(2)}×</span>
            </label>
          </div>
          <div class="flex-1 min-h-0">
            {hydration.state === 'ready' && source ? (
              <Canvas source={source} zoom={zoom} onDiagnostics={onDiagnostics} />
            ) : (
              <div class="h-full" />
            )}
          </div>
        </section>
        <PresenceRail
          self={
            identity
              ? { ...identity, peerId }
              : { name: 'you', color: 'var(--color-muted)', peerId }
          }
          peers={peerEntries}
        />
      </main>
      {!identity ? <NicknameModal onSave={onSaveIdentity} /> : null}
    </>
  );
}

function isAwarenessPayload(x: unknown): x is AwarenessPayload {
  if (!x || typeof x !== 'object') return false;
  const r = x as Record<string, unknown>;
  return (
    typeof r.name === 'string' &&
    typeof r.color === 'string' &&
    typeof r.from === 'number' &&
    typeof r.to === 'number'
  );
}

function HydrationBadge({ hydration }: { hydration: Hydration }): JSX.Element {
  let label: string;
  switch (hydration.state) {
    case 'loading':
      label = 'loading';
      break;
    case 'ready':
      label = hydration.restored ? 'restored' : 'fresh';
      break;
    case 'failed':
      label = 'storage error';
      break;
  }
  return <span class="badge-pill text-xs font-[var(--font-mono)]">{label}</span>;
}

function ConnBadge({ conn }: { conn: ConnectionState }): JSX.Element {
  let label: string;
  let bg: string;
  let fg = 'var(--color-on-dark)';
  if (conn.signaling !== 'open') {
    label = conn.signaling === 'connecting' ? 'connecting…' : 'no signal';
    bg = 'var(--color-surface-card)';
    fg = 'var(--color-muted)';
  } else if (conn.openPeers === 0) {
    label = 'solo';
    bg = 'var(--color-surface-card)';
    fg = 'var(--color-muted)';
  } else {
    label = `${conn.openPeers} peer${conn.openPeers === 1 ? '' : 's'}`;
    bg = 'var(--color-accent-emerald)';
  }
  return (
    <span
      class="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium"
      style={`background:${bg};color:${fg};`}
    >
      {label}
    </span>
  );
}

function DiagPanel({ diags }: { diags: CompileDiagnostic[] }): JSX.Element | null {
  if (diags.length === 0) return null;
  return (
    <div
      class="shrink-0 max-h-40 overflow-auto border-t font-[var(--font-mono)] text-xs"
      style="border-color: var(--color-hairline); background: var(--color-surface-card);"
    >
      <ul class="p-3 m-0 list-none space-y-1">
        {diags.map((d) => (
          <li
            key={`${d.type}:${d.line ?? ''}:${d.column ?? ''}:${d.message}`}
            style={`color: ${
              d.type === 'error'
                ? 'var(--color-accent-rose)'
                : d.type === 'warning'
                  ? 'var(--color-primary)'
                  : 'var(--color-muted)'
            };`}
          >
            <span class="opacity-60">{d.type}</span>
            {d.line != null ? <span class="opacity-60"> · L{d.line}</span> : null}
            <span> — {d.message}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
