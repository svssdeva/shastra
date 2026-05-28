# Trishul

> A Rust MCP server that gives Claude a **body in your Linux machine** — live process tree, network listeners, USB topology, host info — without parsing `ps`/`ss`/`lsusb` output.

Most MCP servers in 2026 are CRUD-over-REST shims for SaaS APIs. Trishul is different: it streams **kernel-grade observability** straight into your assistant. Ask in plain English what's running, what's listening, what's plugged in. Claude calls the right tool, gets a structured JSON snapshot, and answers.

```
 ┌────────────────┐   stdio (JSON-RPC)    ┌──────────────────────┐
 │ Claude Desktop │ ────────────────────► │  trishul-mcp (Rust)  │
 │ / Code / SDK   │ ◄──────────────────── │   ↓ collectors       │
 └────────────────┘                       │   /proc /sys /etc    │
                                          └──────────────────────┘
```

## What you can ask

Once wired in, these prompts all just work:

> "What's eating my CPU right now?"
> "Anything listening on port 5432?"
> "Show me the descendants of pid 1234."
> "What's plugged in via USB?"
> "How many threads is Chrome running?"
> "What kind of machine am I on, and is it swapping?"

## Quick start

```bash
git clone <your-fork>/trishul && cd trishul
cargo install --path crates/trishul-mcp
trishul-mcp selftest    # sanity-check: every tool should print `ok`
```

Then add to `~/.config/Claude/claude_desktop_config.json` (or any other MCP-aware client):

```json
{
  "mcpServers": {
    "trishul": { "command": "trishul-mcp" }
  }
}
```

Full wiring guides (Claude Desktop, Claude Code, Cursor, Continue, Zed, Agent SDK) in [`docs/CLAUDE_CONFIG.md`](docs/CLAUDE_CONFIG.md).

## Tools (MVP)

| Tool | Needs | Returns |
|---|---|---|
| `host_info` | userspace | kernel, distro, uptime, load, memory, CPU count |
| `process_tree` | userspace | nested tree from any PID with cmdline/exe/uid/RSS/threads |
| `proc_snapshot` | userspace | top-N processes by RSS |
| `process_detail` | userspace | one PID: status, exe, cwd, environment (when permitted) |
| `network_listeners` | userspace | TCP/UDP LISTEN sockets resolved to owning PID |
| `usb_devices` | userspace | USB topology with vendor/product names from usb.ids |

Full catalog with args + sample output: [`docs/TOOLS.md`](docs/TOOLS.md).

## Architecture

- **Single Rust binary**, spawned per session by your MCP client. No daemon, no service to manage.
- **Cargo workspace** with one bin + one collector module per tool. Each collector is a pure function returning a uniform `{ summary, data, warnings, truncated }` envelope — token-efficient for the LLM, drillable when needed.
- **Built on `rmcp 1.7`** (Anthropic's Rust MCP SDK) + `tokio` + `procfs` + `nix`. Linux-only MVP.
- **No panics, ever.** Permission gaps and missing optional tools surface as `warnings`, never as fatal errors.

## Status

MVP. Six tools shipped. Linux-only. macOS/Windows + the following tools are deferred:

- `syscall_trace` — eBPF tracepoint snapshots via `aya` (needs `CAP_BPF`).
- `gpu_telemetry` — NVIDIA (NVML), AMD/Intel via sysfs.
- `block_devices` — disks, partitions, SMART summary.

Track progress: [implementation plan](../docs/superpowers/plans/2026-05-28-trishul.md).

## Develop

```bash
cargo test --workspace                              # 7 unit tests
cargo run -- selftest                               # exercise every tool live
cargo clippy --all-targets -- -D warnings           # lints
cargo fmt --check                                   # style
```

If your project tree is on a `noexec` mount, set `CARGO_TARGET_DIR=/tmp/trishul-target`.

## Name

*Trishul* (Sanskrit: त्रिशूल) — *trident*. Three prongs into the running machine: **processes**, **hardware**, **network**.

## License

MIT.
