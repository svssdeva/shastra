# Naadi — full A-Z guide

> One reference doc that covers **what naadi is**, **how every directory fits
> together**, **how to run it**, and **every knob you can turn**. If
> [`README.md`](../README.md) is the front door, this is the floor plan.
>
> This file is the single source of truth — the web app's `/docs` route
> renders this same markdown with a sticky TOC sidebar; edits here flow
> through to the rendered site without duplication.

---

## Table of contents

1.  [What is naadi?](#1-what-is-naadi)
2.  [Architecture in one diagram](#2-architecture-in-one-diagram)
3.  [Quickstart — three commands](#3-quickstart--three-commands)
4.  [The repository, top to bottom](#4-the-repository-top-to-bottom)
5.  [What's where](#5-whats-where)
6.  [Apps deep-dive](#6-apps-deep-dive)
    - [`apps/web`](#61-appsweb--astro--preact-room-ui)
    - [`apps/signal`](#62-appssignal--bun-websocket-signaling)
7.  [Packages deep-dive](#7-packages-deep-dive)
    - [`@naadi/gpu`](#71-naadigpu--webgpu-runtime)
    - [`@naadi/doc`](#72-naadidoc--loro-crdt--cm-binding)
    - [`@naadi/net`](#73-naadinet--webrtc-mesh)
8.  [The room lifecycle](#8-the-room-lifecycle)
9.  [Data flow — a single keystroke](#9-data-flow--a-single-keystroke)
10. [Wire protocols](#10-wire-protocols)
11. [The WGSL contract](#11-the-wgsl-contract)
12. [Environment variables](#12-environment-variables)
13. [Building for production](#13-building-for-production)
14. [Testing](#14-testing)
15. [Troubleshooting](#15-troubleshooting)
16. [Security model](#16-security-model)
17. [Glossary](#17-glossary)
18. [FAQ](#18-faq)
19. [Reading list](#19-reading-list)

---

## 1. What is naadi?

**Naadi is a multiplayer WGSL shader sandbox.** Two or more people open the
same `/r#<id>` URL; they share **one** WGSL fragment shader; each peer's GPU
recompiles and renders that shader independently in real time.

```
┌────────────────────┐                      ┌────────────────────┐
│  Browser A         │                      │  Browser B         │
│                    │                      │                    │
│  ┌──────────────┐  │ ◄── WebRTC P2P ───►  │  ┌──────────────┐  │
│  │ CodeMirror   │  │      Loro updates    │  │ CodeMirror   │  │
│  │ + WGSL parse │  │      + awareness     │  │ + WGSL parse │  │
│  └──────────────┘  │                      │  └──────────────┘  │
│  ┌──────────────┐  │                      │  ┌──────────────┐  │
│  │ WebGPU       │  │                      │  │ WebGPU       │  │
│  │ canvas (own  │  │                      │  │ canvas (own  │  │
│  │ GPU pixels)  │  │                      │  │ GPU pixels)  │  │
│  └──────────────┘  │                      │  └──────────────┘  │
└─────────┬──────────┘                      └─────────┬──────────┘
          │                                           │
          │       ws://signal/ws (SDP + ICE only)     │
          └──────────────────►◄──────────────────────┘
                           ┌──────────────────┐
                           │  apps/signal     │
                           │  Bun WS server   │
                           │  (~150 LOC)      │
                           └──────────────────┘
```

The signaling server only helps peers **discover each other** via SDP/ICE
exchange. Once the WebRTC DataChannel is open, every keystroke flows
**peer-to-peer** — zero server bandwidth in the data path, and the signaling
server can crash mid-session without breaking active editing.

The CRDT (Loro) makes the multiplayer story honest: concurrent edits merge
without conflicts, late joiners catch up via snapshot, offline edits reconcile
when peers reconnect. The WebGPU canvas means rendering scales with the
viewer's hardware, not the host's.

---

## 2. Architecture in one diagram

```
                                Browser tab
┌──────────────────────────────────────────────────────────────────┐
│                                                                  │
│   Astro page (SSR via @astrojs/node)                             │
│      /                — landing                                  │
│      /r/[room]        — SSR shell + Preact island                │
│                                                                  │
│   ┌──────────────────────────────────────────────────────────┐   │
│   │  Preact island: <NaadiRoom>  (client:only="preact")      │   │
│   │                                                          │   │
│   │   ┌────────────────┐  ┌────────────┐  ┌────────────┐     │   │
│   │   │ <Editor>       │  │ <Canvas>   │  │ <Presence  │     │   │
│   │   │  CodeMirror 6  │  │  WebGPU    │  │   Rail>    │     │   │
│   │   │  + WGSL lang   │  │  rAF loop  │  │  peer list │     │   │
│   │   │  + Loro bind   │  │  recompile │  │            │     │   │
│   │   │  + cursor mark │  │  on edit   │  │            │     │   │
│   │   └────────┬───────┘  └─────▲──────┘  └─────▲──────┘     │   │
│   │            │ text events    │ source        │ awareness  │   │
│   │            ▼                │               │            │   │
│   │   ┌──────────────────────────────────────────────────┐   │   │
│   │   │  LoroDoc (text container = "shader")             │   │   │
│   │   │  • subscribe()       → render text changes       │   │   │
│   │   │  • subscribeLocal..  → broadcast deltas          │   │   │
│   │   │  • export(snapshot)  → IDB + new-peer handshake  │   │   │
│   │   └──────────┬───────────────────────────┬───────────┘   │   │
│   │              ▼                           ▼               │   │
│   │   ┌─────────────────────┐  ┌──────────────────────────┐  │   │
│   │   │ @naadi/doc          │  │ @naadi/net               │  │   │
│   │   │ • cm-binding        │  │ • SignalingClient (WS)   │  │   │
│   │   │ • persistence (IDB) │  │ • Peer (RTCPeerConn.)    │  │   │
│   │   └─────────────────────┘  │ • Network (mesh manager) │  │   │
│   │                            │ • codec (binary frames)  │  │   │
│   │                            └──────────┬───────────────┘  │   │
│   └──────────────────────────────────────│──────────────────┘   │
│                                          │                      │
└──────────────────────────────────────────│──────────────────────┘
                          ┌────────────────┘
                          ▼
                  ┌────────────────┐               ┌────────────────┐
                  │ WS signaling   │ ◄── peers ──► │ Other browser  │
                  │ /ws            │  exchange     │ same /r#<id>   │
                  │ /health        │  SDP + ICE    │                │
                  │ (apps/signal)  │               │                │
                  └────────────────┘               └────────────────┘
                          ▲
                          │
                  Bun-native HTTP+WS server, ~150 LOC.
                  Forwards opaque `sig` envelopes; no persistence.
```

---

## 3. Quickstart — three commands

Prerequisites: **Bun ≥ 1.3** on the host, a desktop WebGPU + WebRTC browser
(Chrome / Edge / Arc / Brave / Safari 26+) for clients.

```bash
# 1. One-time install
cd naadi
bun install

# 2. Start the signaling server (Terminal A)
bun --filter @naadi/signal dev          # → ws://localhost:3030/ws

# 3. Start the web app (Terminal B)
bun dev                                  # → http://localhost:4322
```

Open `http://localhost:4322`, click **Create room**, share the resulting
`/r/<32-hex>` URL with a second browser window.

---

## 4. The repository, top to bottom

```
naadi/
├─ README.md             — high-level pitch + quickstart
├─ docs/
│  └─ GUIDE.md           — this file
├─ package.json          — workspace root; "naadi" private, no runtime deps
├─ bunfig.toml           — install.linker = "isolated"
├─ biome.json            — lint config (Biome 2)
├─ tsconfig.json         — shared compiler settings (strict, ES2022, Bundler)
├─ .gitignore            — naadi-specific ignores (layered on the workspace one)
├─ .env.example          — documented env vars (copy to .env to override)
├─ bun.lock              — tracked lockfile
│
├─ apps/
│  ├─ web/               — Astro 6 + Preact 10 + Tailwind v4 (pure SSG)
│  │  ├─ astro.config.mjs      output:"static", @tailwindcss/vite, loro optimizeDeps.exclude
│  │  ├─ tsconfig.json
│  │  ├─ package.json
│  │  └─ src/
│  │     ├─ env.d.ts            — astro/client + @webgpu/types references
│  │     ├─ pages/
│  │     │  ├─ index.astro      — landing
│  │     │  ├─ docs.astro       — /docs (imports docs/GUIDE.md)
│  │     │  └─ r.astro          — static room shell; mounts <NaadiRoom>; room ID from window.location.hash
│  │     ├─ styles/
│  │     │  └─ global.css       — Tailwind v4 + @theme tokens from design.md
│  │     ├─ lib/
│  │     │  ├─ identity.ts      — nickname + color persistence
│  │     │  └─ peer-id.ts       — local peer ID + newRoomId() + SIGNAL_URL
│  │     └─ components/         — Preact island + helpers
│  │        ├─ NaadiRoom.tsx        — top-level island; orchestrator
│  │        ├─ Editor.tsx           — CodeMirror 6 wrapper
│  │        ├─ Canvas.tsx           — WebGPU canvas + status pill
│  │        ├─ PresenceRail.tsx     — peer list w/ color dots
│  │        ├─ NicknameModal.tsx    — first-visit identity capture
│  │        ├─ awareness-ext.ts     — remote-cursor + local-emit CM extensions
│  │        └─ wgsl-lang.ts         — StreamLanguage WGSL tokenizer
│  │
│  └─ signal/            — Bun-native HTTP + WS signaling server
│     ├─ src/
│     │  ├─ index.ts            — server entrypoint (Bun.serve)
│     │  └─ protocol.ts         — Wire types + query parser
│     ├─ tsconfig.json
│     └─ package.json
│
└─ packages/
   ├─ gpu/               — @naadi/gpu — WebGPU runtime
   │  ├─ src/
   │  │  ├─ index.ts             — barrel
   │  │  ├─ device.ts            — adapter+device acquire, WebGPUUnavailable
   │  │  ├─ pipeline.ts          — fullscreen-quad render pipeline factory
   │  │  ├─ uniforms.ts          — std140-ish uniform buffer layout
   │  │  ├─ recompile.ts         — single-flight Recompiler queue
   │  │  ├─ prelude.ts           — hidden WGSL header (vs_main + uniforms)
   │  │  └─ preset.ts            — bundled shader presets (cosine-rainbow default + 11 others)
   │  └─ package.json
   │
   ├─ doc/               — @naadi/doc — Loro + CodeMirror binding + IDB
   │  ├─ src/
   │  │  ├─ index.ts             — barrel
   │  │  ├─ schema.ts            — createDoc(), seedIfEmpty()
   │  │  ├─ cm-binding.ts        — CM 6 ViewPlugin ↔ LoroText
   │  │  └─ persistence.ts       — IDB load/save + autosave bind
   │  ├─ tests/
   │  │  └─ loro-roundtrip.test.ts
   │  └─ package.json
   │
   └─ net/               — @naadi/net — WebRTC mesh transport
      ├─ src/
      │  ├─ index.ts              — barrel
      │  ├─ codec.ts              — tagged binary frames (snapshot/update/aware)
      │  ├─ signaling.ts          — WS client w/ reconnect backoff
      │  ├─ peer.ts               — RTCPeerConnection + DataChannel wrapper
      │  └─ room.ts               — Network class: mesh + Loro broadcast wiring
      ├─ tests/
      │  └─ codec.test.ts
      └─ package.json
```

---

## 5. What's where

### Files you edit when…

| Goal | File |
|---|---|
| Change the default shader or add a preset | `packages/gpu/src/preset.ts` (also register it in `PRESETS` and re-export from `index.ts`) |
| Change the uniform layout / add a new uniform | `packages/gpu/src/{uniforms,prelude}.ts` |
| Tweak the WGSL syntax highlighter | `apps/web/src/components/wgsl-lang.ts` |
| Change the editor theme / keymap | `apps/web/src/components/Editor.tsx` |
| Add new wire frame types between peers | `packages/net/src/codec.ts` |
| Change the awareness payload schema | `apps/web/src/components/NaadiRoom.tsx` (`AwarenessPayload`) + `awareness-ext.ts` |
| Add a new field to the shared CRDT doc | `packages/doc/src/schema.ts` |
| Persistence interval / storage backend | `packages/doc/src/persistence.ts` |
| ICE servers (STUN/TURN) | Pass `iceServers` to `new Network({...})` in `NaadiRoom.tsx` |
| Landing-page copy | `apps/web/src/pages/index.astro` |
| Room-page top nav (Copy link button etc) | `apps/web/src/pages/r.astro` |
| Color palette / nickname rules | `apps/web/src/lib/identity.ts` |
| Signaling protocol | `apps/signal/src/protocol.ts` (shared shape lives independently in `@naadi/net/signaling.ts`) |
| Build / deploy / port / signal URL | `naadi/.env`, `naadi/apps/web/package.json` |

### Files you should **not** need to touch

- `apps/web/astro.config.mjs` — wires Preact + Tailwind v4 + @astrojs/node.
- `bunfig.toml` — installer mode.
- `tsconfig.json` (root) — strict TS settings inherited by every workspace.
- `biome.json` — lint config.

---

## 6. Apps deep-dive

### 6.1. `apps/web` — Astro + Preact room UI

Astro 6 in **pure static** output mode (`output: 'static'`, no adapter). All
three routes — `/`, `/r`, `/docs` — prerender to flat HTML files. There is
no Node runtime in the data path; deploys are bytes on a CDN.

We dodge the "infinite room IDs vs `getStaticPaths()`" problem by putting
the room ID in the URL **fragment** instead of the path: `/r#<32hex>`. The
`/r.astro` page is a single static shell that mounts the Preact island; the
island reads `window.location.hash` on mount and validates it. Bad/missing
hash → client-side redirect to `/`.

Vite quirk worth knowing: Loro's WASM is **excluded from `optimizeDeps`** in
`astro.config.mjs`. The pre-bundler otherwise drops the WASM in
`node_modules/.vite/deps/` but doesn't serve it (404 on hydration). With
the exclusion, Vite serves Loro from its own `bundler/` directory and the
WASM loads cleanly.

The interactive UI is **one Preact island** (`<NaadiRoom client:only="preact">`).
`client:only` skips SSR for that component, so server requests don't try to
instantiate Loro WASM or WebGPU. The room shell HTML you see in `curl` is
pure layout; everything live mounts on hydration.

Key responsibilities of `NaadiRoom.tsx`:

1. Owns a single `LoroDoc` per mount (re-mounts only when `room` changes).
2. Loads any IndexedDB snapshot under that room ID; seeds with `DEFAULT_WGSL`
   if empty; binds debounced autosave.
3. Starts a `Network` connection to the signaling server (using a persistent
   per-browser 16-hex peer ID from localStorage).
4. Subscribes to the doc → mirrors text into a `source` React state so the
   `<Canvas>` sees changes.
5. Maintains a `Map<peerId, AwarenessPayload>`; updates it from the network's
   `onAwareness` callback; clears entries on `onPeerLeave`.
6. Throttles the **local** cursor emit (50 ms cooldown).
7. Re-broadcasts our own awareness when our identity changes.
8. Renders Editor / Canvas / PresenceRail in a 3-column grid.

### 6.2. `apps/signal` — Bun WebSocket signaling

Bun-native HTTP + WS server, no framework. About 110 lines after lints. It
exposes exactly two endpoints:

- **`GET /health`** — returns `{ ok: true, rooms: N, peers: M }` for liveness
  probes / debugging.
- **`WS /ws?room=<32hex>&peer=<16hex>`** — the only thing the browser
  actually uses. Per-connection state is `{ room, peer }`.

Server behavior:

- **On open** — adds the socket to a `Map<roomId, Map<peerId, ws>>`, sends
  the joiner the existing peer list (`{t:'peers', peers:[...]}`), then
  broadcasts a `{t:'join', peer:<id>}` to all others in the room.
- **On message** — only accepts `{t:'sig', to, payload}`. Forwards as
  `{t:'sig', from:<sender>, payload}` to the target socket if it exists in
  the same room. Server never inspects `payload` — that's opaque SDP / ICE.
- **On close** — removes from the room map, broadcasts `{t:'leave', peer}`,
  GCs empty rooms.
- **Reload tolerance** — if a peer ID rejoins while an old socket exists
  (e.g. tab reload), the old one is closed first.
- **Idle timeout** — Bun's built-in 60 s WebSocket idle drop.

The server is intentionally dumb. There's no room enumeration endpoint. Room
IDs are 128-bit random — possessing a URL is the only capability.

---

## 7. Packages deep-dive

### 7.1. `@naadi/gpu` — WebGPU runtime

#### Exports

| Name | What it does |
|---|---|
| `acquireDevice()` | `requestAdapter()` + `requestDevice()`. Throws `WebGPUUnavailable` if the browser/driver can't satisfy the request. |
| `WebGPUUnavailable` | Distinguishable error class for capability gating. |
| `makeBindGroupLayout(device)` | One uniform binding at `@group(0) @binding(0)`, visible to vertex+fragment. |
| `compilePipeline(deps, userSource)` | Concatenates `NAADI_PRELUDE + userSource`, creates a `GPUShaderModule`, surfaces compile messages, builds the pipeline. Returns `{pipeline, diagnostics}`. |
| `Recompiler` | Single-flight wrapper around `compilePipeline` — if a recompile is requested while one is in flight, the newest source is queued and run after. |
| `UNIFORMS_BYTES`, `writeUniforms(buf, vals)` | 32-byte uniform buffer layout: `vec2 resolution / f32 time / f32 zoom / vec2 mouse / pad`. |
| `NAADI_PRELUDE` | The hidden WGSL header. Defines `NaadiUniforms`, `PI`, `TAU`, `vs_main` (fullscreen-triangle). The user's source is appended after it. |
| `DEFAULT_WGSL` | Friendly starter shader — cosine-rainbow that respects `u.time` and `u.resolution`. |
| `PRESETS` | Bundled `{id, label, source}` palette surfaced by the editor's preset picker (cosine-rainbow, plasma, mandelbrot, tunnel, voronoi, cyberpunk avatar, anime waifu, minecraft planet, tron horizon, black hole, CRT glitch, hyperspace). |
| `PRELUDE_LINE_COUNT` | Used by diagnostics to report user-facing line numbers (subtract from `lineNum`). |

#### The pipeline

```
vs_main → fullscreen triangle (3 verts, position only)
fs_main → user-defined, receives @builtin(position) frag
        → returns @location(0) vec4<f32>
bind group 0 → uniform buffer "u"
```

The Canvas component calls `device.queue.writeBuffer(uniformBuf, 0, scratch)`
each frame to update time, mouse, and the zoom-slider value, then draws three
vertices. Mouse is a normalized `(x,y)` of the canvas rect; zoom is the value
of the slider in the Canvas pane header (default `1.0`, reset on preset
switch).

### 7.2. `@naadi/doc` — Loro CRDT + CM binding

Loro is a Rust→WASM CRDT engine. We use exactly one container — a `LoroText`
named `"shader"` — and never write metadata anywhere else (which keeps the
binding code trivial).

#### `cm-binding.ts`

The binding is a CodeMirror 6 **ViewPlugin**:

```
       local user keystroke
              │
              ▼
  CodeMirror transaction (docChanged)
              │
              ▼
  for each change: text.delete + text.insert
              │
              ▼
  doc.commit() ───►  subscribeLocalUpdates fires
                       (binary delta bytes)
                              │
                              ▼
                     @naadi/net broadcasts to peers
```

When a remote delta arrives, `doc.import(bytes)` triggers the `subscribe()`
listener with `event.by === 'import'`. The binding then computes the new
text and dispatches a CM change wrapped with an `Annotation` so the local
side doesn't echo it back to Loro.

#### `persistence.ts`

- `loadSnapshot(doc, roomId)` — reads `IDBObjectStore("snapshots")[roomId]`,
  imports if present. Returns `true` if data was restored.
- `bindPersistence(doc, roomId)` — subscribes to the doc; on any change,
  schedules a 2 s-debounced `doc.export({mode:'snapshot'})` → IDB put.
- `saveSnapshotBytes(roomId, bytes)` — used by **Fork** to seed a fresh room
  with the current state before navigating.

### 7.3. `@naadi/net` — WebRTC mesh

#### `signaling.ts` — `SignalingClient`

Thin wrapper over a single WebSocket to `ws://signal/ws?room=…&peer=…`. On
close, reconnects with exponential backoff (500 ms → 8 s cap). Exposes
`send({t:'sig', to, payload})` for outbound, and a single `onMessage`
callback for inbound `peers / join / leave / sig` frames.

#### `peer.ts` — `Peer`

Wraps one `RTCPeerConnection` and one `RTCDataChannel`. Roles:

- **Offerer** — the newcomer to the room offers to every existing peer it
  learned from the initial `peers` envelope.
- **Answerer** — existing peers answer offers from new joiners.

Handlers (`sendSignal`, `onOpen`, `onMessage`, `onClose`, `onError`) are
injected by `Network`, which translates them into appropriate Loro doc
operations and UI events.

#### `room.ts` — `Network`

The orchestrator. On construction:

1. Opens the signaling WebSocket.
2. Subscribes `doc.subscribeLocalUpdates(bytes => broadcast({kind:'update', bytes}))`.

On signaling events:

- `peers` — for every existing peer ID, create a `Peer(role:'offerer')`,
  start the SDP negotiation.
- `join` — create a `Peer(role:'answerer')`; SDP comes in via `sig`.
- `leave` — destroy peer; emit `onPeerLeave`.
- `sig from:X` — route to `peers.get(X).ingestSignal(payload)`.

On `Peer` open:

1. Send our current full Loro snapshot over the new channel (the remote will
   `doc.import(snapshot)` and converge instantly even if they have local
   edits).
2. Notify the UI (`onPeerJoin`, `onConnectionState`).

On `Peer` message:

- Decode the binary frame. `snapshot` and `update` go through `doc.import`
  (wrapped in try/catch — malformed bytes drop the peer, never crash).
- `awareness` payloads are forwarded to `opts.onAwareness(peerId, payload)`.

#### `codec.ts` — binary framing

```
byte 0 : tag  (0x01 snapshot, 0x02 update, 0x03 awareness)
rest   : opaque bytes
```

Snapshots and updates are raw Loro binary. Awareness is UTF-8 JSON.

---

## 8. The room lifecycle

### A. First visitor (peer "A")

```
0. user → http://localhost:4322
1. landing page → "Create room"
2. JS generates new 128-bit roomId, navigates to /r#<id>
3. Astro serves the static /r/index.html (top nav + island placeholder)
4. Browser hydrates <NaadiRoom>; island reads window.location.hash
5. NicknameModal shown (first visit ever)
6. user picks "AmberOtter" + a color, modal closes
7. Loro doc created, IDB lookup (empty), DEFAULT_WGSL seeded
8. Persistence bound; Network started
9. SignalingClient opens WS /ws?room=…&peer=…
10. Server replies {t:'peers', peers:[]} — solo room
11. Editor + Canvas mount; canvas compiles default shader; renders
```

### B. Second visitor (peer "B") on same URL

```
12. B's NaadiRoom mounts identically.
13. SignalingClient opens; server replies {t:'peers', peers:['A']}.
14. B creates Peer(role:'offerer', remote:'A'); creates DataChannel; offer.
15. Server forwards {t:'sig', from:'B', payload:<sdp offer>} → A.
16. A also got {t:'join', peer:'B'} so it had created Peer(role:'answerer').
17. A.ingestSignal sets remote desc → creates answer → server forwards to B.
18. ICE candidates flow both ways via {t:'sig'} envelopes.
19. DataChannel "naadi" opens on both sides.
20. Each side sends its current snapshot through the channel; both import.
21. Subsequent local edits go through subscribeLocalUpdates → broadcast.
```

### C. Steady state

```
- B types a character.
- CM transaction fires → loroExtension converts to LoroText insert.
- doc.commit() → subscribeLocalUpdates emits delta bytes.
- Network.broadcast({kind:'update', bytes}) → every open peer DataChannel.
- A receives → decode → doc.import(bytes).
- A's doc.subscribe fires (event.by==='import') → setSource(text.toString())
  in NaadiRoom → Canvas sees new prop, debounces recompile → next frame
  uses the new pipeline.
- B's cursor moves → localCursorEmitter → throttled awareness broadcast.
- A receives awareness → setAwareness map → CM dispatches setRemotePresences
  effect → cursor decoration with B's name+color appears at the right pos.
```

### D. Departure

```
- B closes the tab.
- B's RTCDataChannel onclose fires on A's side → cleanup.
- B's WS closes → server broadcasts {t:'leave', peer:'B'} → A removes peer
  from awareness map → PresenceRail re-renders.
- A's Loro doc keeps the current shader (and IDB still has the snapshot);
  next time anyone visits with the same URL, the doc is restored from IDB.
```

### E. Total reload

If both peers leave AND lose their localstorage / IDB, the next visitor to
that URL starts with an empty Loro doc → `seedIfEmpty(DEFAULT_WGSL)` → a
fresh room. **Naadi has no server-side persistence.**

---

## 9. Data flow — a single keystroke

```
┌─────────────────────────────────────────────────────────────────┐
│ User presses 'X' in the editor                                  │
└─────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│ CodeMirror dispatches a transaction (docChanged=true)           │
└─────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│ loroExtension.update():                                         │
│   for each change in the changeset:                             │
│     text.delete(fromA, toA - fromA);                            │
│     text.insert(fromA, inserted.toString());                    │
│   doc.commit();                                                 │
└─────────────────────────────────────────────────────────────────┘
                            │
              ┌─────────────┼─────────────────────────────────┐
              ▼             ▼                                 ▼
   ┌──────────────────┐  ┌──────────────────────┐    ┌────────────────────┐
   │ doc.subscribe    │  │ subscribeLocalUpdates│    │ persistence timer  │
   │ (by:'local')     │  │ → bytes (delta)      │    │ resets to t+2 sec  │
   │                  │  │                      │    │                    │
   │ NaadiRoom        │  │ Network.broadcast    │    │ on fire:           │
   │ setSource(...)   │  │ ({kind:'update'})    │    │   doc.export       │
   │                  │  │                      │    │   ({mode:'snapshot'}│
   │ Canvas sees prop │  │ for each open peer:  │    │   → IDB put        │
   │ → debounced      │  │   DataChannel.send   │    │                    │
   │   recompile      │  │     (tagged bytes)   │    │                    │
   └────────┬─────────┘  └────────┬─────────────┘    └────────────────────┘
            ▼                     ▼
   ┌──────────────────┐  ┌─────────────────────────┐
   │ Recompiler queue │  │ Remote peer's DC.onmsg  │
   │ → next frame uses│  │ → decode(buf)           │
   │ new pipeline     │  │ → doc.import(bytes)     │
   └──────────────────┘  │ → subscribe fires       │
                         │   (by:'import')         │
                         │ → cm-binding dispatches │
                         │   change w/ annotation  │
                         │ → editor shows char     │
                         └─────────────────────────┘
```

---

## 10. Wire protocols

### 10.1. Browser ↔ Signaling server (JSON-over-WS)

```ts
// Server → Client
type ServerToClient =
  | { t: 'peers'; peers: string[] }              // sent once on join
  | { t: 'join';  peer: string }                 // a peer arrived in our room
  | { t: 'leave'; peer: string }                 // a peer left
  | { t: 'sig';   from: string; payload: unknown };  // forwarded from peer

// Client → Server
type ClientToServer = { t: 'sig'; to: string; payload: unknown };
```

The `payload` field is **opaque** to the server. In practice it carries one
of:

```ts
{ type: 'sdp', sdp: RTCSessionDescriptionInit }    // offer or answer
{ type: 'ice', candidate: RTCIceCandidateInit }
```

### 10.2. Peer ↔ Peer (binary over DataChannel)

```
byte 0    │ tag
bytes 1+  │ payload
```

| Tag  | Payload                                                                    |
|------|----------------------------------------------------------------------------|
| 0x01 | Loro **snapshot** bytes (sent once when DataChannel opens; for sync)       |
| 0x02 | Loro **update** bytes (sent on every local commit; incremental)            |
| 0x03 | UTF-8 JSON-encoded **awareness** payload (cursor/selection + name + color) |

### 10.3. Awareness payload (current shape)

```ts
interface AwarenessPayload {
  name: string;     // up to 24 chars
  color: string;    // hex from the palette in identity.ts
  from: number;     // selection start, absolute offset in the doc text
  to: number;       // selection end (== from for caret)
}
```

Awareness is **not** part of the CRDT — it's ephemeral, last-write-wins per
peerId, garbage-collected when the peer disconnects.

---

## 11. The WGSL contract

You write a single function:

```wgsl
@fragment
fn fs_main(@builtin(position) frag: vec4<f32>) -> @location(0) vec4<f32> {
  // ...
}
```

…and a hidden prelude makes the following available to you:

```wgsl
struct NaadiUniforms {
  resolution: vec2<f32>,
  time: f32,
  zoom: f32,
  mouse: vec2<f32>,
  _pad1: vec2<f32>,
};
@group(0) @binding(0) var<uniform> u: NaadiUniforms;

const PI:  f32 = 3.14159265358979323846;
const TAU: f32 = 6.28318530717958647692;

@vertex
fn vs_main(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
  // fullscreen triangle
}
```

### What you have

- `u.resolution` — canvas size in physical pixels.
- `u.time`       — seconds since canvas mount.
- `u.zoom`       — UI zoom slider, default `1.0`. Bundled presets divide their
  `uv` by `u.zoom` so the slider scales the scene; custom shaders can opt in
  the same way. Auto-resets to `1.0` on preset switch.
- `u.mouse`      — normalized (x,y) where (0,0) is top-left, (1,1) bottom-right.
- `PI`, `TAU`.

### What you must do

- Define exactly one `@fragment fn fs_main(...)` returning `@location(0) vec4<f32>`.
- Do not redefine `vs_main`, `NaadiUniforms`, or `u`.
- Do not introduce non-WGSL syntax. The pipeline factory passes your source
  unmodified to `device.createShaderModule`.

### Diagnostics

`compilePipeline` returns a `diagnostics` array. `lineNum` includes prelude
lines — subtract `PRELUDE_LINE_COUNT` to map back to the user's editor line.
The current UI surfaces messages in a small panel below the editor (color
coded by severity).

---

## 12. Environment variables

Copy `naadi/.env.example` to `naadi/.env` to override defaults.

| Variable                       | Used by             | Default                    | Purpose |
|--------------------------------|---------------------|----------------------------|---------|
| `PUBLIC_NAADI_SIGNAL_URL`      | `apps/web`          | `ws://localhost:3030/ws`   | WebSocket endpoint the browser tries to reach. Must be `wss://...` over TLS in production. The `PUBLIC_` prefix is required for Astro/Vite to inline it in client bundles. |
| `PORT`                         | `apps/signal`       | `3030`                     | HTTP + WS port of the signaling server. |

> The Astro web app reads `import.meta.env.PUBLIC_NAADI_SIGNAL_URL` **at
> build time**. If you change it in `.env`, restart `bun dev` (HMR alone
> won't pick it up).

---

## 13. Building for production

```bash
# Build the web app (signal app needs no build; bun runs the .ts directly)
bun --filter @naadi/web build
# → apps/web/dist/
#       index.html            — landing
#       r/index.html          — room shell (any /r#<id> hash works here)
#       docs/index.html       — the GUIDE rendered with the design tokens
#       _astro/*              — bundled JS + Loro WASM, content-hashed

# Serve the static output anywhere — CDN, S3, Caddy, GH Pages, even file://.
bunx serve apps/web/dist

# Run the signal server as a daemon
PORT=3030 bun apps/signal/src/index.ts
```

### Deploy topology

```
              ┌──────────────────────────────┐
              │  CDN / static host           │
              │  serves apps/web/dist/*      │  ← entirely static; no runtime
              └──────────────────────────────┘
                            ▲
                            │ https://your.host/r#<id>
       browser ─────────────┤
                            │
                            ▼
                   /r/index.html (3 KB)
                   + _astro/NaadiRoom.<hash>.js (~125 KB gzip)
                   + _astro/loro_wasm_bg.<hash>.wasm (~1 MB gzip)
                                  │
                                  ▼ parses location.hash,
                                    starts Loro doc, WebRTC mesh

       browser ─────► wss://your.host/ws ─────►  Bun signal server
                                                  (port 3030 behind TLS proxy)
```

Because the room URL is `/r#<id>` (fragment, not path), the host only ever
sees a request for `/r/`. **No SPA-fallback config needed**; works on hosts
that don't support it (GH Pages, S3 with index.html only, plain nginx).

Set `PUBLIC_NAADI_SIGNAL_URL=wss://your.host/ws` when you run `bun build`.

### Behind a reverse proxy

The signal server speaks ordinary WebSocket over HTTP. Standard nginx /
Caddy `proxy_pass http://localhost:3030;` with WebSocket upgrade headers
works without modification. Terminate TLS at the proxy and the browser
gets `wss://`.

### TURN

The default ICE config in `room.ts` is just `stun:stun.l.google.com:19302`.
For peers behind symmetric NAT or restrictive corporate firewalls you'll
want a TURN server (coturn, Twilio NTS, etc.) — pass `iceServers` when you
construct `Network({...})` in `NaadiRoom.tsx`:

```ts
network = new Network({
  signalUrl: SIGNAL_URL,
  room, peer: peerId, doc: naadi.doc,
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'turn:turn.your.host:3478', username: '...', credential: '...' },
  ],
  // ...
});
```

---

## 14. Testing

### Unit tests

```bash
bun --filter '*' test          # 8 tests across @naadi/doc + @naadi/net
```

Covers:

- Loro snapshot/update roundtrip (export A → import B preserves text).
- Loro incremental updates converge two clean docs.
- `seedIfEmpty` is idempotent.
- Binary codec roundtrips all three frame types.
- Codec rejects unknown tags + empty frames.

### Lint + typecheck

```bash
bun run lint                                  # biome
bun x tsc --noEmit -p apps/web/tsconfig.json
bun x tsc --noEmit -p apps/signal/tsconfig.json
```

### Manual cross-tab smoke

1. Start signal server + dev server (terminals A and B above).
2. Open two Chromium-family windows on `http://localhost:4322`.
3. Click **Create room** in one; copy the URL; paste into the second.
4. The connection pill in both should turn emerald (`1 peer`) once the
   DataChannel opens.
5. Type in either window — the other should see edits within ~200 ms LAN.
6. Move the cursor — the other should see a colored caret with your nickname.
7. Type **invalid** WGSL — the canvas should keep showing the last good frame
   while an error pill turns red.
8. Kill the signaling server. The two tabs should **keep** editing each
   other (peer connection is P2P). When you restart signaling and reload,
   they reconnect.

### Production build verification

```bash
bun --filter @naadi/web build && node apps/web/dist/server/entry.mjs &
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:4321/
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:4321/r/0123456789abcdef0123456789abcdef
```

(Default Astro preview port is 4321 — adjust if you set `PORT`.)

---

## 15. Troubleshooting

### "no webgpu" pill, red

- The browser doesn't expose `navigator.gpu` or `requestAdapter()` returned
  `null`. Use Chrome / Edge / Arc / Brave / Safari 26+ on the desktop.
- VMs, RDP/SSH-X11, and headless browsers usually don't have a usable GPU.
- On Linux, certain Mesa configurations need `--enable-features=Vulkan` on
  the Chrome launch line.

### "device lost: ..." pill

- The GPU driver fault-recovered. Most often: a shader that spins/diverges,
  or Windows TDR after >2 s on a single render.
- Reload the tab — the next mount re-acquires the device.
- If it happens repeatedly with simple shaders, your driver is the issue
  (see yantra's README "Driver notes" section for the brand-specific list).

### Connection pill says "no signal" or stays "connecting…"

- The signaling server isn't reachable. Confirm `bun --filter @naadi/signal dev`
  is running. Check `curl http://localhost:3030/health`.
- If you set `PUBLIC_NAADI_SIGNAL_URL`, restart `bun dev` so the new value
  is bundled.

### Connection pill says "solo" with another tab open

- WS handshake succeeded but WebRTC didn't. Open DevTools → Network → WS
  → message tab, you should see SDP and ICE envelopes for both peers.
- Try the same domain in both tabs (not `localhost` and `127.0.0.1`).
- Corporate networks, symmetric NAT, or strict firewalls block UDP. Add a
  TURN server (see [Building for production](#13-building-for-production)).
- Chrome's "Block third-party cookies in incognito" doesn't matter; CSP
  does — if you have a custom CSP, ensure `connect-src` allows your WS
  origin.

### Edits don't sync but pill is emerald

- One peer's CRDT diverged from a malformed snapshot. Rare, but the catch
  block in `room.ts` drops the offender. Look in the console for
  `import from <peer> failed:`.
- Refresh both tabs. The newer snapshot wins.

### Editor scrolls weirdly / cursor jumps to top on remote edits

- The naïve binding replaces the whole CM doc on remote changes. For very
  large shaders this can re-anchor the viewport. Open a PR with a finer
  diff if it bites you — `subscribePreCommit` exposes the exact ops.

### CSS layout looks broken

- The `@theme` block in `apps/web/src/styles/global.css` requires Tailwind
  v4. If you ever swap to v3, replace the `@theme` block with a
  `tailwind.config.js` and reintroduce design-token CSS variables manually.

### "Cannot find type definition file for 'bun'" during `tsc`

- The root `tsconfig.json` deliberately doesn't include bun-types so the web
  build stays clean. Only `apps/signal/tsconfig.json` pulls them in, scoped
  to that workspace.

---

## 16. Security model

### Threat: malicious shader

- WGSL has no FFI, no DOM access, no network calls — the GPU sandbox is the
  enforcement boundary.
- A hostile shader can still hang the GPU (`while (true) {}`). Browsers
  recover via device-loss; naadi surfaces it in the UI.
- Large allocations: the pipeline factory caps buffer sizes implicitly by
  not exposing any user-driven sizes.

### Threat: malicious peer

- A peer can send malformed Loro bytes. `Network.handleSignal` and the per-
  peer `onMessage` wrap `doc.import` in try/catch — bad bytes drop the
  peer's connection (we don't blacklist; rejoin always allowed).
- A peer can claim any peer ID. Spoofing is uninteresting because the only
  thing peer IDs gate is **inbox routing** for signaling envelopes; they
  don't authorize anything. If you want stronger identity, sign awareness
  payloads with a per-tab keypair — that's not in v0.

### Threat: signaling server

- The server learns: room IDs, ephemeral peer IDs, peer-to-peer envelope
  sizes/timing. It cannot read SDP / ICE / data payloads in any way that
  helps it MITM (it would need to substitute SDP fingerprints, which the
  browser would catch on DTLS verification).
- The server holds no persistent state. A compromise reveals the live
  set of open rooms, nothing historic.

### Threat: shoulder-surfing the URL

- Room IDs are 128-bit random. Capability-style URLs are the only access
  control. Don't paste them into public channels you don't want joiners on.

### What's **not** in v0

- No e2e encryption beyond what DTLS gives DataChannel automatically.
- No rate-limiting / abuse mitigation on the signal server.
- No moderation tooling — there are no moderators by design.

---

## 17. Glossary

| Term | Meaning |
|------|---------|
| **CRDT** | Conflict-free Replicated Data Type. Lets concurrent edits merge deterministically without a coordinator. |
| **Loro** | The specific CRDT engine we use. Rust core compiled to WASM, exposed to JS. |
| **WebRTC** | Browser API for peer-to-peer audio/video/data. We use the **DataChannel** subset for arbitrary binary messages. |
| **SDP** | Session Description Protocol. The text blob WebRTC peers exchange to negotiate codecs / transports. |
| **ICE candidate** | A potential network path between peers (host, srflx via STUN, relay via TURN). |
| **STUN / TURN** | Helpers for traversing NATs. STUN tells you your public IP+port; TURN relays your traffic if direct UDP doesn't work. |
| **WGSL** | The WebGPU Shading Language. The WebGPU equivalent of GLSL/HLSL. |
| **Astro island** | A small interactive Preact/React/Svelte component embedded in an otherwise-static Astro page. `client:only` skips SSR for it. |
| **CodeMirror 6** | The editor framework. Composed entirely of small extensions; no plugin store. |
| **Awareness** | Ephemeral per-peer presence state (cursor, name, color). Not part of the CRDT, garbage-collected when a peer disconnects. |
| **Fork** | Snapshot the current room's shader into a fresh room ID. |

---

## 18. FAQ

**Q. Why Loro instead of Yjs?**
A. Loro is Rust-native, has rich time-travel built in, and the bundle size
is comparable. Yjs would also work; the binding shape is similar.

**Q. Why a custom signal server instead of `y-webrtc` / `peerjs`?**
A. We're not using Yjs (so `y-webrtc` is out), and `peerjs` requires their
own public server / config we don't need. A 110-line Bun server fits the
spec and keeps deps lean.

**Q. Can more than ~6 peers join a room?**
A. Mesh topology scales O(N²) in connections; the practical wall is 6–8
peers per room. Beyond that you'd want a star topology with a relay node
or SFU — not currently implemented.

**Q. Why is the WASM bundle 3 MB?**
A. That's Loro's Rust runtime. It gzips to ~1 MB and is cached after the
first visit. The non-WASM client bundle is ~125 KB gzip.

**Q. Can I share rooms across the internet, not just LAN?**
A. Yes, but you need a TURN server if either peer is behind a NAT that
won't allow inbound UDP — see [§13](#13-building-for-production).

**Q. Is there cursor history / replay?**
A. Loro supports it (`doc.checkout(version)`), but we don't expose a UI
for it in v0. It's the cleanest thing to add next if you want one.

**Q. What about voice / video chat?**
A. Out of scope. The DataChannel transport already exists; piping
`getUserMedia` audio/video tracks through the same `RTCPeerConnection`
is straightforward but not in v0.

**Q. Why no Tailwind config file?**
A. Tailwind v4 introduced first-class CSS-based config via `@theme`. The
config is at the top of `apps/web/src/styles/global.css`.

**Q. Why static instead of SSR, given infinite room IDs?**
A. We dodge the `getStaticPaths()` problem by putting the room ID in the
URL **fragment**: `/r#<id>` instead of `/r/<id>`. A single static
`/r/index.html` handles every room; the Preact island reads
`window.location.hash` on mount. Same clean room URLs, zero runtime, deploys
on any static host. Tradeoff: the room ID isn't visible to the server
(fragments never are), which is also the privacy default we wanted.

---

## 19. Reading list

- WGSL spec — https://www.w3.org/TR/WGSL/
- WebGPU best practices — https://toji.dev/webgpu-best-practices/
- Loro docs — https://loro.dev/docs
- CodeMirror 6 reference — https://codemirror.net/docs/ref/
- WebRTC perfect negotiation pattern — https://developer.mozilla.org/docs/Web/API/WebRTC_API/Perfect_negotiation_pattern
- Astro 6 changelog — https://github.com/withastro/astro/blob/main/packages/astro/CHANGELOG.md
- Tailwind v4 — https://tailwindcss.com/blog/tailwindcss-v4
- ClickHouse house design (we borrow the tokens) — see `../design.md`

If you find a spot in the code that this guide doesn't explain, that's a
bug in the guide — please update it.
