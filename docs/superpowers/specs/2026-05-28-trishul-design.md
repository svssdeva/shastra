# Trishul — MCP server that gives Claude a body in your machine

**Status**: Design (v1)
**Date**: 2026-05-28
**Author**: Claude (drafted on behalf of svssdeva)

---

## Context

Claude (via Claude Code / Desktop / Agent SDK) can read files and run shells, but lacks a *first-class* view of OS-level state — process trees, USB topology, network listeners, GPU telemetry, live syscalls. To get that view today, Claude shells out to `ps`, `lsof`, `lsusb`, `ss`, `nvidia-smi`, parses ad-hoc text, and burns tokens on garbage. Each call is a guess.

MCP servers are flooding the ecosystem, but ~99% are CRUD-over-REST shims (Notion, GitHub, Slack). A Rust MCP server that streams *kernel-grade* observability into Claude is rare, useful, and demoable in one screenshot. It fills three gaps in svssdeva's portfolio at once: **MCP** (none), **CLI/observability** (Trinetra is web-only), **kernel-adjacent** (none).

Sanskrit naming pattern (Trinetra, Dasha, Yantra, Tithi-Mala). **Trishul** = trident — three prongs into the running machine: **processes**, **hardware**, **network**.

**Outcome**: A single Rust binary (`trishul`) that any Claude client can launch over stdio MCP. Claude gets clean, structured access to live OS state without parsing text. Distribution: `cargo install trishul-mcp` + one `claude_desktop_config.json` snippet.

---

## Non-goals (YAGNI)

- Not an APM / metrics backend. No long-term storage, no time-series DB.
- Not cross-platform in MVP. **Linux-only.** macOS via dtrace + sysctl is post-MVP.
- Not a streaming subscription bus. Each MCP tool call returns a single snapshot.
- No auth / sandboxing inside the server. The server runs as the user's local process; trust boundary is the same as `ps`.
- No remote mode. stdio only. (Cloud agents on the user's machine via Claude Code's local-runner are still supported — they invoke the binary directly.)
- No GUI. CLI install + JSON config. (Stretch: optional `--debug` TUI to verify what Claude is seeing.)

---

## MVP Scope (Linux)

A Rust binary speaking MCP over stdio exposing these tools:

| Tool | Needs | What it returns |
|---|---|---|
| `process_tree` | userspace | Whole process tree rooted at PID (default 1), with cmdline, exe, RSS, CPU%, threads |
| `proc_snapshot` | userspace | htop-grade list: top N by CPU or RSS, with user, state, prio, args |
| `process_detail` | userspace | One PID: env (if accessible), open fds, cwd, exe, status, limits, cgroup |
| `usb_devices` | userspace | USB topology with vendor/product names resolved from `/usr/share/hwdata/usb.ids` (or fallback) |
| `network_listeners` | userspace | TCP/UDP sockets in LISTEN with owning PID/process |
| `gpu_telemetry` | userspace | NVIDIA (via NVML or nvidia-smi shell-out) + AMD (sysfs `hwmon`) + Intel (sysfs) GPU stats |
| `block_devices` | userspace | Disks/partitions, sizes, mountpoints, filesystem, free space, SMART summary if `smartctl` present |
| `host_info` | userspace | Kernel, distro, uptime, load, memory, NUMA, mounts summary |
| `syscall_trace` ⚡ | CAP_BPF | Tail N most recent syscalls for a PID (eBPF tracepoint). Snapshot only. **Stretch**. |

Every tool:
- Validates inputs with `schemars`-driven JSON-Schema (MCP requires it).
- Returns structured JSON the LLM can reason over, plus a `summary` text field for "tool result" display.
- Caps result size (e.g. `process_tree` truncates at 5000 PIDs with a `truncated: true` marker).
- Reads from `/proc`, `/sys`, `/dev` directly — no shell-outs except documented fallbacks (`nvidia-smi`, `smartctl`).

---

## Architecture

```
                          ┌────────────────────────┐
   Claude (Desktop /      │  stdin (JSON-RPC)      │
   Code / Agent SDK) ────►│   ↑    ↓               │
                          │   server loop          │
                          │ (rmcp + tokio)         │
                          │                        │
                          │  tool dispatch         │
                          │  ┌─────────────────┐   │
                          │  │ tool registry   │   │
                          │  └──────┬──────────┘   │
                          │         │              │
                          │  ┌──────▼──────────┐   │
                          │  │ collectors      │   │
                          │  │ - proc          │   │
                          │  │ - usb           │   │
                          │  │ - net           │   │
                          │  │ - gpu           │   │
                          │  │ - block         │   │
                          │  │ - host          │   │
                          │  │ - ebpf (gated)  │   │
                          │  └─────────────────┘   │
                          │  stderr → log file     │
                          └────────────────────────┘
```

### Why this shape

- **MCP over stdio** is the default Claude Desktop / Code transport. JSON-RPC framed by Content-Length.
- **rmcp** (the official Rust MCP SDK published by Anthropic) handles framing + schema reflection + tool registration. Saves writing protocol code.
- **One process, no threads of concern**. Tokio multi-thread runtime; each tool call is an async future. Snapshots are fast enough (~10–50ms) that we don't need a background sampler.
- **Collectors are independent modules.** `proc` reads `/proc`, `usb` reads `/sys/bus/usb`, `net` reads `/proc/net/tcp` + `/proc/net/udp`, etc. Each is a pure function `async fn collect(args) -> Result<View>` with its own unit tests using fixtures.
- **eBPF is gated.** The `ebpf` module compiles, but at runtime it probes `CAP_BPF` and returns a structured `RequiresCapability` error if missing. No panics, no surprise root prompts.

### Tool contract shape

Every tool has:
```rust
#[derive(JsonSchema, Deserialize)]
struct Args { /* ... */ }

#[derive(Serialize)]
struct Output {
  summary: String,           // human-readable one-paragraph synthesis
  data: serde_json::Value,   // structured payload
  truncated: bool,           // capped flag
  warnings: Vec<String>,     // permission gaps, missing tools, etc.
}
```

Claude can either read `summary` directly or drill into `data`. Token-efficient by default; deep-dive on demand.

---

## Component breakdown

| Crate / module | Purpose | Key deps |
|---|---|---|
| `trishul-mcp` (bin) | CLI + MCP server entrypoint, registers tools | `clap`, `rmcp`, `tokio`, `tracing` |
| `trishul-core` (lib) | Shared types: `Output`, `Pid`, error type, helpers | `serde`, `thiserror`, `schemars` |
| `trishul-proc` | `/proc` reader: process tree, snapshots, detail, fds | `procfs`, `nix` |
| `trishul-usb` | `/sys/bus/usb` walker + USB ID lookup | `udev` (optional), embedded `usb.ids` fallback |
| `trishul-net` | `/proc/net/{tcp,tcp6,udp,udp6}` + inode→PID resolution | `procfs` |
| `trishul-gpu` | NVIDIA (NVML via `nvml-wrapper`), AMD/Intel via sysfs | `nvml-wrapper` (optional) |
| `trishul-block` | Block devices + filesystems + SMART | reads `/sys/block`, shells `smartctl` |
| `trishul-host` | uname, load, mem, cgroup v2 summary | `procfs`, `nix` |
| `trishul-ebpf` ⚡ | Syscall trace via aya. Builds the BPF program | `aya`, `aya-build` |

Each `trishul-*` crate is a workspace member. Splits keep compile times reasonable and let users `cargo install` the binary without forcing eBPF deps if they skip the `ebpf` feature.

---

## Repo layout

```
trishul/
├─ Cargo.toml              # workspace
├─ crates/
│  ├─ trishul-mcp/         # bin
│  │  ├─ Cargo.toml
│  │  └─ src/main.rs
│  ├─ trishul-core/
│  ├─ trishul-proc/
│  ├─ trishul-usb/
│  ├─ trishul-net/
│  ├─ trishul-gpu/
│  ├─ trishul-block/
│  ├─ trishul-host/
│  └─ trishul-ebpf/        # behind `--features ebpf`
├─ docs/
│  ├─ CLAUDE_CONFIG.md     # how to wire it into Claude Desktop / Code
│  └─ TOOLS.md             # tool catalog with examples
├─ fixtures/                # synthetic /proc trees for tests
└─ README.md
```

---

## Error handling

```rust
#[derive(Debug, Error)]
pub enum TrishulError {
    #[error("permission denied reading {path}")]
    Permission { path: String },
    #[error("tool requires capability {0}")]
    RequiresCapability(&'static str),
    #[error("optional dependency missing: {name} ({hint})")]
    MissingDep { name: &'static str, hint: &'static str },
    #[error(transparent)] Io(#[from] std::io::Error),
    #[error(transparent)] Procfs(#[from] procfs::ProcError),
    #[error("invalid args: {0}")]
    BadArgs(String),
}
```

- Permission gaps **never panic**. They surface as `warnings: ["could not read /proc/123/environ (perms)"]` on a per-PID basis.
- Missing optional tools (`nvidia-smi`, `smartctl`) become warnings, not errors.
- `RequiresCapability` is returned as a structured MCP error with the hint "run with `setcap cap_bpf=eip trishul-mcp` or via sudo".

---

## Testing strategy

- **Unit (cargo test, no root needed)**: each collector takes a `Source` trait so tests inject fixtures.
  - `trishul-proc`: synthetic `/proc/<pid>/{status,stat,cmdline,exe,fd/*}` trees in `fixtures/`.
  - `trishul-usb`: synthetic `/sys/bus/usb/devices/*` trees.
  - `trishul-net`: paste real `/proc/net/tcp` samples; assert parse + filter.
  - `trishul-gpu`: stub NVML + sysfs.
- **Integration**: `cargo test -p trishul-mcp` spawns the binary, sends real MCP `tools/list` and `tools/call` JSON-RPC frames, asserts response shape.
- **Property**: `process_tree` returns a forest (no cycles), every child's parent appears in the result, root is always PID 1 or the requested root.
- **Doctests** for the public collector APIs.
- **CI**: GitHub Actions matrix on Ubuntu 22.04 + Ubuntu 24.04; rustfmt + clippy + test + miri on `trishul-core`.

---

## Verification (end-to-end)

After the MVP a user can:

1. `cargo install --path crates/trishul-mcp`.
2. Add to `~/.config/Claude/claude_desktop_config.json`:
   ```json
   { "mcpServers": { "trishul": { "command": "trishul-mcp" } } }
   ```
3. Restart Claude Desktop. The "🔌 Trishul" tools appear in the tool picker.
4. Ask Claude: *"What's eating my CPU right now?"* → Claude calls `proc_snapshot`, gets a structured top-10, summarizes.
5. *"What's plugged in via USB?"* → `usb_devices` → categorized list with vendor names.
6. *"Anything listening on port 5432?"* → `network_listeners` filters → "yes, PID 1234 (postgres)".
7. *"Can my GPU run a 7B model?"* → `gpu_telemetry` → memory total/free, driver, current utilization.

Headless verification:
- `cargo test --workspace` → all unit + property tests pass.
- `cargo run -p trishul-mcp -- --selftest` → exercises every tool once, prints pass/fail summary. Useful for CI and bug reports.

---

## Build phases

1. **Phase 0 — scaffold**: workspace, crate skeletons, `rmcp` echo server. ~½ day.
2. **Phase 1 — core types + first tool (`host_info`)**: prove the end-to-end loop with the simplest collector. End: Claude Desktop sees a `host_info` tool and can call it. ~1 day.
3. **Phase 2 — proc tools**: `process_tree`, `proc_snapshot`, `process_detail`. The bulk of the value. ~2-3 days.
4. **Phase 3 — net + usb + block + gpu**: each collector independently. ~3-4 days.
5. **Phase 4 — polish**: `--selftest`, docs (`CLAUDE_CONFIG.md`, `TOOLS.md`), README screenshot of Claude using the tools, CI. ~1-2 days.
6. **Phase 5 (stretch)** — eBPF syscall trace. ~3-5 days because aya + tracepoints + capability detection.

MVP target (Phases 0–4): ~1.5 weeks solo.

---

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| `rmcp` crate API churn (still pre-1.0) | Pin a specific version; CI flags break early; vendor types into `trishul-core` if needed |
| `/proc` permission requirements for cross-user PIDs | Per-PID warnings, never fail the call; document that running as the same user gives best results |
| NVML availability (driver-specific) | Make `nvml-wrapper` an optional dep; fall back to shelling `nvidia-smi`; gracefully report "no GPU sources" |
| eBPF userland headers vary across kernels | aya bundles bindings; gate to kernel ≥ 5.8 with explicit message |
| Output token blowup (snapshot of huge box) | Hard caps + `truncated: true`; pagination args (`limit`, `offset`, `pid_filter`) on every list-like tool |
| MCP schema must round-trip | Use `schemars` derives; integration test calls `tools/list` and validates schema JSON |
| Demo-fragility on niche kernels | Add `--selftest` and document its output in the bug template |

---

## Self-grill log (decisions resolved)

> *Per the `grill-me` skill: every decision branch interrogated, recommendation given, locked.*

- **Q: Why Rust and not Go?** A: Aya for eBPF is best-in-class in Rust; svssdeva ships polished Rust (Trinetra); avoids GC pauses for future streaming. Lock: Rust.
- **Q: Why one binary vs daemon + CLI?** A: MCP servers are spawned per session by the client. A daemon adds install pain and gains nothing here. Lock: single binary.
- **Q: Why aya vs libbpf-rs?** A: aya is pure Rust, no clang/libbpf system dep, cleaner cross-compile. Lock: aya. (Stretch only.)
- **Q: Why not Polars / Arrow for the JSON output?** A: LLM consumes JSON. Arrow adds size and a dep nobody needs. Lock: serde_json.
- **Q: What about Windows?** A: Different APIs (ETW, PerfLib). Doubles the test matrix and slows MVP. Defer. Lock: Linux MVP.
- **Q: Could this become a Cloudflare-style "MCP-as-a-service"?** A: Maybe later. The "runs locally" story is the differentiator today. Lock: local first.
- **Q: Will Claude know how to use these tools without prompting?** A: Tool descriptions are LLM-facing; we write them well. Each schema includes `description` for fields and `examples` where helpful.
- **Q: Should the server cache between calls?** A: No. Snapshot freshness matters more than 5 ms latency. Lock: stateless.

## Open questions

None blocking. Phase-5 eBPF specifics (which tracepoints, ring buffer sizing) deferred to that phase's plan section.
