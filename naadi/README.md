# naadi

> Multiplayer WebGPU shader sandbox. Co-edit one WGSL fragment shader; every
> peer's GPU renders the shared scene independently. CRDT (Loro) + WebRTC P2P,
> in a browser tab.

> **The full A-Z reference** — what every file does, the room lifecycle,
> wire protocols, troubleshooting, security model, glossary — lives in
> [`docs/GUIDE.md`](./docs/GUIDE.md). The same content is served by the web
> app at [`/docs`](http://localhost:4322/docs) when running locally (sticky
> TOC sidebar, anchor links, same design tokens as the app).

## How to run

You need **Bun ≥ 1.3** and a **WebGPU + WebRTC capable browser** (desktop
Chrome / Edge / Arc / Brave / Safari 26+). One-time install:

```bash
cd naadi
bun install
```

Naadi runs **two processes** locally. Open two terminals:

```bash
# Terminal A — signaling server (~150 LOC, forwards SDP/ICE only)
bun --filter @naadi/signal dev      # → ws://localhost:3030/ws

# Terminal B — web app (Astro SSR via @astrojs/node)
bun dev                              # → http://localhost:4322
```

In the browser:

1. Open `http://localhost:4322`, click **Create room** — you'll land on
   `/r#<32-hex>` (the room ID lives in the URL fragment, so the whole site
   stays pure static; see [§13](./docs/GUIDE.md#13-building-for-production)).
2. On first visit a modal asks for a nickname + color (stored in
   `localStorage`; not sent to the server).
3. Copy the URL and open it in a **second** browser window or another machine
   on the LAN.
4. Type WGSL in either window — every peer's editor stays in sync via Loro,
   and every peer's GPU recompiles + renders the new shader on its own.

Use the **Preset…** dropdown above the editor to load a bundled shader
(cosine rainbow, plasma, mandelbrot, voronoi, **cyberpunk avatar**,
**anime waifu**, **minecraft planet**, hyperspace, …). The **zoom** slider
in the Canvas pane drives a `u.zoom` uniform consumed by the bundled
presets (1.00× default, auto-resets on preset switch).

Use **Fork →** to snapshot the current shader into a fresh room; **Copy
link** to send the URL; the connection pill turns emerald when a WebRTC
DataChannel is open to at least one peer.

## Stack

- **Astro 6** (pure static SSG; deploys anywhere) + **Preact 10** (`client:only` island)
- **Tailwind CSS v4** (`@tailwindcss/vite`, design tokens via `@theme`) — design
  system follows the workspace-level [`design.md`](../design.md) (ClickHouse-
  style black canvas + electric-yellow accent)
- **Loro** CRDT (Rust → WASM) for the shared shader document, with
  CodeMirror 6 binding + 2 s-debounced IndexedDB snapshots
- **WebRTC DataChannel** for peer transport; tiny Bun signaling server
- **WebGPU + WGSL** fullscreen-quad pipeline; `u.time`, `u.resolution`,
  `u.mouse` uniforms are auto-bound from a hidden prelude
- **Bun 1.3** workspace · **Biome** lint · **MIT** license

## Layout

```
naadi/
├─ apps/
│  ├─ web/      Astro site + Preact room UI (what `bun dev` serves)
│  └─ signal/   Bun WS signaling server — forwards SDP/ICE between sockets
└─ packages/
   ├─ doc/     @naadi/doc — Loro schema + CodeMirror binding + IDB snapshots
   ├─ net/     @naadi/net — WebRTC mesh transport + binary frame codec
   └─ gpu/     @naadi/gpu — WebGPU shader runtime + WGSL prelude + recompiler
```

## Verify

```bash
bun --filter '*' test          # @naadi/doc Loro roundtrip + @naadi/net codec
bun run lint                    # biome check (clean)

# Manual: open the dev server in two Chromium windows on /r/<same-id>.
# Editor + cursor sync should land < 200 ms on LAN; canvas keeps rendering
# the last-good frame when you type invalid WGSL.
```

## Build for production

```bash
bun run build                   # → apps/web/dist/   (three static HTML pages + _astro/ assets)

# Serve the static output with anything — CDN, S3, Caddy, GH Pages, file://.
# Locally:
bunx serve apps/web/dist

# Run the signal server as its own daemon
PORT=3030 bun apps/signal/src/index.ts
```

For a real deploy: ship `apps/web/dist/` to your CDN; run the signal server
behind a TLS-terminating reverse proxy on `wss://...`; point
`PUBLIC_NAADI_SIGNAL_URL` at that URL when you build. The signal server is
the only thing that needs a runtime — the web app is bytes on disk.

## Configuration

Copy [`.env.example`](./.env.example) to `.env` to override defaults.

| Env var                        | Default                       | Meaning |
| ------------------------------ | ----------------------------- | ------- |
| `PUBLIC_NAADI_SIGNAL_URL`      | `ws://localhost:3030/ws`      | WS signaling endpoint the browser connects to. Must be `wss://...` in production. |
| `PORT` (signal server only)    | `3030`                        | HTTP/WS port for `apps/signal`. |

## Privacy

- No server-side persistence. The signaling server holds only ephemeral
  socket sets per room and forwards opaque SDP/ICE envelopes.
- Room IDs are 128-bit random — anyone with the URL can join.
- No accounts, analytics, or telemetry.
- Local doc snapshots live in browser IndexedDB under the room ID.

## Security model

- **Untrusted WGSL** runs on the local GPU only. WGSL is sandboxed by the
  spec (no FFI, no DOM). A hostile shader can still hang or trip device-loss
  recovery — the canvas surfaces `device lost: <reason>` to the user.
- **Untrusted CRDT updates** from peers are wrapped in try/catch; malformed
  bytes drop that peer without crashing neighbors.
- **Signaling server is dumb** — opaque envelope forwarding, no room
  enumeration endpoint, knowledge of room URL = capability.

## License

MIT.
