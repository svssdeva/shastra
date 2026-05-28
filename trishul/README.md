# Trishul

> A Rust MCP server that gives Claude a **body in your Linux machine** — live process tree, network listeners, USB topology, host info, **and an eBPF syscall trace** — without parsing `ps`/`ss`/`lsusb`/`strace` output.

> **Platform support:** **Linux only.** macOS and Windows are not supported and the binary will refuse to compile on those targets. macOS would need `sysctl` + `libproc` + IOKit backends; Windows would need ETW + PerfLib + WMI. Both are tracked as future work. See the [platform notes](#platform-support) below.

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

## Tools

| Tool | Needs | Returns |
|---|---|---|
| `host_info` | userspace | kernel, distro, uptime, load, memory, CPU count |
| `process_tree` | userspace | nested tree from any PID with cmdline/exe/uid/RSS/threads |
| `proc_snapshot` | userspace | top-N processes by RSS |
| `process_detail` | userspace | one PID: status, exe, cwd, environment (when permitted) |
| `network_listeners` | userspace | TCP/UDP LISTEN sockets resolved to owning PID |
| `usb_devices` | userspace | USB topology with vendor/product names from usb.ids |
| `syscall_trace` | **CAP_BPF + CAP_PERFMON** | eBPF tracepoint snapshot of per-PID syscall counts over a window |

Full catalog with args + sample output: [`docs/TOOLS.md`](docs/TOOLS.md).

### Granting CAP_BPF (one-time)

`syscall_trace` is the only tool that needs more than userspace permissions. Either:

```bash
# preferred: file capability, no sudo at runtime
sudo setcap cap_bpf,cap_perfmon=eip $(which trishul-mcp)
```

…or run the MCP client itself with `sudo`. Without these capabilities, the tool returns a structured `RequiresCapability` error with the same hint.

## Architecture

- **Single Rust binary**, spawned per session by your MCP client. No daemon, no service to manage.
- **Cargo workspace** with one bin + one collector module per tool. Each collector is a pure function returning a uniform `{ summary, data, warnings, truncated }` envelope — token-efficient for the LLM, drillable when needed.
- **Built on `rmcp 1.7`** (Anthropic's Rust MCP SDK) + `tokio` + `procfs` + `nix`. Linux-only MVP.
- **No panics, ever.** Permission gaps and missing optional tools surface as `warnings`, never as fatal errors.

## Architecture (eBPF deep dive)

`syscall_trace` is a real eBPF program — not a `strace` shell-out or polling hack.

- **`crates/trishul-ebpf/`** — `no_std` crate that compiles to `bpfel-unknown-none`. Implements a `raw_syscalls/sys_enter` tracepoint that increments a per-PID-per-syscall counter in a kernel `HashMap`. Built with `aya-ebpf` + the nightly Rust BPF target via `bpf-linker`.
- **`build.rs`** uses `aya_build::build_ebpf` to compile the BPF crate at build time and embed the verified ELF into the userspace binary via `include_bytes!`.
- **`collectors/ebpf.rs`** loads the program via `aya::Ebpf::load`, attaches the tracepoint, sleeps for the configured window, then iterates the kernel `HashMap` and returns the top-N syscalls per PID with stable x86_64 syscall-name resolution.
- A capability **precheck** runs before any BPF call — it reads `CapEff:` from `/proc/self/status` and short-circuits with a clear `setcap` hint if `CAP_BPF` or `CAP_PERFMON` is missing. No cryptic `errno -1`s reach the client.

## Status

MVP+Phase5. Seven tools shipped including real eBPF. Linux-only.

Future:

- `gpu_telemetry` — NVIDIA (NVML), AMD/Intel via sysfs.
- `block_devices` — disks, partitions, SMART summary.
- macOS backend (sysctl + libproc + IOKit).
- Windows backend (ETW + PerfLib + WMI).

Track progress: [implementation plan](../docs/superpowers/plans/2026-05-28-trishul.md).

## Platform support

Linux only, today. The binary will fail to compile on macOS and Windows with a clear `compile_error!` pointing here. The reason is structural, not laziness:

| Trishul tool | Linux backend | macOS equivalent | Windows equivalent |
|---|---|---|---|
| `host_info` | `/proc/{meminfo,loadavg,uptime}`, `uname()` | `sysctl`, `host_statistics64` | `GetSystemInfo`, `GlobalMemoryStatusEx` |
| `process_tree` | `/proc/<pid>/{stat,status,cmdline}` | `proc_listpids` + `proc_pidinfo` (libproc) | `CreateToolhelp32Snapshot` |
| `network_listeners` | `/proc/net/{tcp,udp}{,6}` | `netstat` shell-out or `libproc.proc_pidsocketinfo` | `GetExtendedTcpTable` / `GetExtendedUdpTable` |
| `usb_devices` | `/sys/bus/usb/devices` | IOKit (`IOServiceMatching("IOUSBDevice")`) | SetupAPI (`SetupDiGetClassDevs`) |
| `syscall_trace` | eBPF (`raw_syscalls/sys_enter`) | DTrace (deprecated, restricted on Apple Silicon) | ETW + `Microsoft-Windows-Kernel-System` provider |

Cross-platform parity is a separate ~2–3 week project. The collector trait can abstract over the backends without touching the MCP surface, but each port requires real platform expertise and a fresh test matrix.

## Develop

The eBPF crate needs Rust **nightly** with `rust-src` plus `bpf-linker`:

```bash
rustup toolchain install nightly --component rust-src
cargo install bpf-linker
```

Then:

```bash
cargo test -p trishul-mcp                           # 7 unit tests
cargo run -- selftest                               # exercise every tool live
cargo clippy --all-targets -- -D warnings           # lints
cargo fmt --check                                   # style
```

The userspace crate builds with **stable** Rust; only `trishul-ebpf` invokes nightly via its own `rust-toolchain.toml`. The `build.rs` orchestrates the two.

If your project tree is on a `noexec` mount, set `CARGO_TARGET_DIR=/tmp/trishul-target`.

## Name

*Trishul* (Sanskrit: त्रिशूल) — *trident*. Three prongs into the running machine: **processes**, **hardware**, **network**.

## License

MIT.
