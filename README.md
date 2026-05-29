# shastra

> Portfolio workspace. Production-grade tools that put Claude — and other humans — in physical contact with real systems: one in your browser tab, one inside your kernel, one in everyone's browser at once.

```
shastra/
├─ yantra/    WebGPU heat-conduction simulator. Drop an STL, watch heat spread.
├─ trishul/   Rust MCP server. Live process / network / USB / syscall view for Claude.
├─ naadi/     Multiplayer WebGPU shader sandbox. CRDT + WebRTC P2P; co-edit one WGSL.
└─ darshan/   Local-first vision agent. Pluggable inference shell. OCR + dashcam in-tab.
```

---

## Projects

| Project | What it is | Stack | Status |
|---|---|---|---|
| [**yantra**](./yantra/) | Finite-element heat-conduction solver running entirely in your browser. Drop an STL, pick a material, set hot/cold faces, watch the colormap evolve as steady-state converges. | Astro 5 · Preact 10 · Three.js · WebGPU + WGSL · Bun | shipped |
| [**trishul**](./trishul/) | MCP server giving Claude live OS observability — process tree, network listeners, USB topology, host info, and a real eBPF / DTrace / ETW syscall trace. 7 tools, cross-platform. | Rust 2024 · rmcp 1.7 · aya · ferrisetw · sysinfo · netstat2 · nusb | shipped |
| [**naadi**](./naadi/) | Multiplayer WebGPU shader sandbox. Co-edit one WGSL fragment shader; every peer's GPU renders the shared scene independently. CRDT-backed, peer-to-peer, zero server bandwidth after handshake. | Astro 5 · Preact 10 · Tailwind v4 · CodeMirror 6 · Loro CRDT · WebRTC · WebGPU + WGSL · Bun | shipped |
| [**darshan**](./darshan/) | Local-first vision agent. Drop a file, run a model in your tab. Pluggable inference shell: swappable pipelines (echo, Devanagari OCR, dashcam incident extractor) on swappable backends (Mock, transformers.js, ORT Web, Rust+WASM). Zero cloud. | Astro 6 · Preact 10 · Tailwind v4 · `tesseract.js` (Hindi) · `@huggingface/transformers` · `onnxruntime-web` · Rust → wasm32 · Bun | shipped |

---

## Yantra — heat sim in a browser tab

```bash
cd yantra
bun install
bun dev    # → http://localhost:4321
```

Then visit `/sim?fx=fins`. Pick **Aluminum**, hit **Solve**, watch the gradient cascade down each fin.

Requires a WebGPU-capable browser (Chrome / Edge / Arc / Brave / Safari 26). Full design + numerics in [`yantra/README.md`](./yantra/README.md).

---

## Trishul — Claude's body inside your machine

```bash
cd trishul
cargo install --path crates/trishul-mcp
trishul-mcp selftest   # every tool should print "ok"
```

Add to your MCP client config (Claude Desktop, Claude Code, Cursor, …):

```json
{ "mcpServers": { "trishul": { "command": "trishul-mcp" } } }
```

Restart the client. Ask Claude: *"Anything listening on port 5432?"* or *"Which processes are doing the most file I/O?"*

Cross-platform: **6 of 7 tools work identically on Linux, macOS, and Windows.** `syscall_trace` uses eBPF (Linux) / DTrace (macOS) / ETW (Windows) depending on host. Full install + privilege docs in [`trishul/README.md`](./trishul/README.md), [`trishul/docs/CLAUDE_CONFIG.md`](./trishul/docs/CLAUDE_CONFIG.md), [`trishul/docs/PRIVILEGES.md`](./trishul/docs/PRIVILEGES.md), and [`trishul/docs/EXAMPLES.md`](./trishul/docs/EXAMPLES.md).

---

## Naadi — multiplayer WebGPU shader sandbox

```bash
cd naadi
bun install

# Terminal A — tiny signaling server (forwards SDP/ICE only)
bun --filter @naadi/signal dev      # → ws://localhost:3030/ws

# Terminal B — web app
bun dev                              # → http://localhost:4322
```

Click **Create room**, share the resulting `/r#<id>` link with a second
browser window. Edits flow over **WebRTC DataChannel** (zero server bandwidth
after handshake); the Loro CRDT keeps everyone in sync; each peer's GPU
renders the shared shader independently. Cursors and nicknames sync as
ephemeral awareness frames. Snapshots persist to per-browser IndexedDB.

A **Preset…** dropdown above the editor swaps in bundled shaders (cosine
rainbow, plasma, mandelbrot, voronoi, cyberpunk avatar, anime waifu,
minecraft planet, hyperspace, …) and a **zoom slider** in the Canvas pane
drives a `u.zoom` uniform read by the bundled presets (default 1.00×,
auto-resets on preset switch).

Requires a WebGPU **and** WebRTC capable browser — desktop Chrome / Edge /
Arc / Brave / Safari 26+. Full design, security model, and config knobs in
[`naadi/README.md`](./naadi/README.md).

---

## Darshan — vision agent in a browser tab

```bash
cd darshan
bun install
bun run build:wasm   # one-time: compiles the Rust WASM core (requires wasm32-unknown-unknown)
bun dev              # → http://localhost:4321
```

Visit `/run` and pick a pipeline: drop a Devanagari image for OCR + Hindi→English translation,
or a dashcam clip for auto-cut incident highlights. Visit `/docs` for the full walkthrough —
concepts (pipeline vs. backend, the seam, worker offload), the pipeline × backend matrix,
request flow, and troubleshooting.

The bet: one UI hosts every pipeline on every backend. `tesseract.js` reads Devanagari +
`@huggingface/transformers` v4 Opus-MT translates Hindi → English; `onnxruntime-web` runs
dashcam YOLO; a Rust crate compiled to `wasm32-unknown-unknown` (no `wasm-bindgen`) ships as the
seam proof for the future `candle-core` drop-in. Privacy proof: after first model load, no
network traffic — verify in airplane mode. Full design in
[`darshan/README.md`](./darshan/README.md) and `/docs` in-app.

---

## Tech stack signature

- **Rust 2024** edition · `rmcp 1.7` · `aya 0.13` (eBPF, Linux) · `ferrisetw 1.2` (ETW, Windows) · `tokio` · `sysinfo` · `netstat2` · `nusb` · `procfs` · `nix` · `candle-core` (target `wasm32-unknown-unknown`, no `wasm-bindgen`).
- **Bun 1.3** workspace · **Astro 6.4** · **Preact 10** · **Three.js 0.184** · **Tailwind v4** · **CodeMirror 6** · **Loro CRDT** · **WebRTC DataChannel** · **WebGPU + WGSL** · **`@huggingface/transformers` v4** · **`onnxruntime-web`** · **`tesseract.js` v7**.
- **Biome 2** + **clippy -D warnings** lint-clean.

Build-environment caveat for this checkout: `/mnt/shared` is mounted `noexec`, so both subprojects symlink their build dirs (`target/`, `node_modules/.bun/`) to `/tmp` to let native build scripts execute. On a normal filesystem you don't need this hack.

---

## Repo layout

```
shastra/
├─ README.md             — this file
├─ .gitignore            — workspace-level
├─ yantra/               — see yantra/README.md
│  ├─ apps/web/          — Astro site + WebGPU sim UI
│  └─ packages/{mesh,solver}/  — STL parse/voxelize + CPU+GPU Jacobi solver
├─ trishul/              — see trishul/README.md
│  └─ crates/{trishul-mcp,trishul-ebpf}/
├─ naadi/                — see naadi/README.md
│  ├─ apps/{web,signal}/ — Astro+Preact room UI + Bun signaling server
│  └─ packages/{doc,net,gpu}/  — Loro+CM binding, WebRTC mesh, WebGPU runtime
└─ darshan/              — see darshan/README.md and /docs in-app
   ├─ apps/web/          — Astro+Preact+Tailwind shell, /run + /docs
   └─ packages/{inference-core,inference-core-wasm,pipeline-ocr,pipeline-dashcam,ui-kit}/
```

---

## License

MIT, applies to every subproject in this workspace.

---

## Why "shastra"

**Shastra** (शस्त्र / शास्त्र) in Sanskrit covers both *instrument / weapon* and *treatise / discipline / body of knowledge*. The first sense reads the workspace as a collection of tools (Yantra = instrument, Trishul = trident — both literal shastras). The second covers anything that's a *system of practice* (a `naadi-shastra` is the discipline of pulse diagnosis; *naadi* itself is the pulse / channel / conduit — fitting for a project where shader bytes flow through WebRTC data channels between peers).
