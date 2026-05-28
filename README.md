# shastra

> Portfolio workspace. Two production-grade tools that put Claude in physical contact with real systems — one in your browser tab, one inside your kernel.

```
shastra/
├─ yantra/          WebGPU heat-conduction simulator. Drop an STL, watch heat spread.
├─ trishul/         Rust MCP server. Live process / network / USB / syscall view for Claude.
└─ agentic-skills/  Curated Claude Code skill library (submodule).
```

---

## Projects

| Project | What it is | Stack | Status |
|---|---|---|---|
| [**yantra**](./yantra/) | Finite-element heat-conduction solver running entirely in your browser. Drop an STL, pick a material, set hot/cold faces, watch the colormap evolve as steady-state converges. | Astro 5 · Preact 10 · Three.js · WebGPU + WGSL · Bun | shipped |
| [**trishul**](./trishul/) | MCP server giving Claude live OS observability — process tree, network listeners, USB topology, host info, and a real eBPF / DTrace / ETW syscall trace. 7 tools, cross-platform. | Rust 2024 · rmcp 1.7 · aya · ferrisetw · sysinfo · netstat2 · nusb | shipped |
| [**agentic-skills**](./agentic-skills/) | Submodule. 116 Claude Code skills organized by domain (rust, react, astro, engineering, …). | Markdown | tracked upstream |

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

## agentic-skills (submodule)

`agentic-skills/` is a `git submodule` pinned to a specific commit of [the skill library](https://github.com/svssdeva/agentic-skills). Clone with:

```bash
git clone --recurse-submodules <this-repo-url>
# or, after a plain clone:
git submodule update --init --recursive
```

Per-project [`CLAUDE.md`](./CLAUDE.md) tells Claude Code to scan it before any task and load the relevant skill files.

---

## Tech stack signature

- **Rust 2024** edition · `rmcp 1.7` · `aya 0.13` (eBPF, Linux) · `ferrisetw 1.2` (ETW, Windows) · `tokio` · `sysinfo` · `netstat2` · `nusb` · `procfs` · `nix`.
- **Bun 1.3** workspace · **Astro 5** · **Preact 10** · **Three.js 0.184** · **WebGPU + WGSL**.
- **Biome** + **clippy -D warnings** lint-clean.

Build-environment caveat for this checkout: `/mnt/shared` is mounted `noexec`, so both subprojects symlink their build dirs (`target/`, `node_modules/.bun/`) to `/tmp` to let native build scripts execute. On a normal filesystem you don't need this hack.

---

## Repo layout

```
shastra/
├─ README.md             — this file
├─ .gitignore            — workspace-level
├─ .gitmodules           — agentic-skills pin
├─ agentic-skills/       — submodule
├─ yantra/               — see yantra/README.md
│  ├─ apps/web/          — Astro site + WebGPU sim UI
│  └─ packages/{mesh,solver}/  — STL parse/voxelize + CPU+GPU Jacobi solver
└─ trishul/              — see trishul/README.md
   └─ crates/{trishul-mcp,trishul-ebpf}/
```

---

## License

MIT, applies to every subproject in this workspace.

---

## Why "shastra"

**Shastra** (शस्त्र / शास्त्र) in Sanskrit covers both *instrument / weapon* and *treatise / discipline / body of knowledge*. The first sense reads the workspace as a collection of tools (Yantra = instrument, Trishul = trident — both literal shastras). The second covers anything that's a *system of practice* (a `naadi-shastra` is the discipline of pulse diagnosis; the `darshana-shastras` are the six classical schools of Indian philosophy). Future Sanskrit-named additions fit naturally either way.
