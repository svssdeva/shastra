# Trishul

> A Rust MCP server that gives Claude a **body in your machine** — live process tree, network listeners, host info on Linux/macOS/Windows, plus USB topology and a **real eBPF syscall trace** on Linux — without parsing `ps`/`ss`/`lsusb`/`strace` output.

> **Platform support:** 5 of 7 tools are cross-platform (Linux/macOS/Windows) via `sysinfo` + `netstat2`. `usb_devices` is Linux-only (reads `/sys/bus/usb`; a libusb backend for macOS/Windows is future work). `syscall_trace` is Linux-only (eBPF does not exist on macOS/Windows; the equivalents are DTrace and ETW respectively, both deferred).

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

| Tool | Platforms | Needs | Returns |
|---|---|---|---|
| `host_info` | linux · macos · windows | userspace | kernel, distro, uptime, load, memory, CPU count + brand |
| `process_tree` | linux · macos · windows | userspace | nested tree from any PID with cmdline/exe/uid/user/RSS/CPU/threads |
| `proc_snapshot` | linux · macos · windows | userspace | top-N processes by RSS or CPU |
| `process_detail` | linux · macos · windows | userspace | one PID: status, exe, cwd, environment (when permitted) |
| `network_listeners` | linux · macos · windows | userspace | TCP/UDP LISTEN sockets resolved to owning PID |
| `usb_devices` | **linux only** | userspace | USB topology with vendor/product names from usb.ids |
| `syscall_trace` | **linux only** | **CAP_BPF + CAP_PERFMON** | eBPF tracepoint snapshot of per-PID syscall counts over a window |

On macOS and Windows, the two Linux-only tools return a structured "unsupported on this OS" MCP error so the LLM can react cleanly instead of seeing a build-time failure or a confusing runtime panic.

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

## Platform support — how it works

The five cross-platform tools share a single source path that abstracts over OS-level details through two production-grade crates:

- **`sysinfo`** wraps `/proc` on Linux, `libproc` + `sysctl` on macOS, and the Windows Performance Data Helper on Windows behind one Rust API. Used by `host_info`, `process_tree`, `proc_snapshot`, and `process_detail`.
- **`netstat2`** wraps `/proc/net/{tcp,udp}{,6}` on Linux, `libproc.proc_pidsocketinfo` on macOS, and `GetExtendedTcpTable` / `GetExtendedUdpTable` on Windows. Used by `network_listeners`.

The two Linux-only tools are honest exceptions:

| Tool | Linux backend | Why no macOS/Windows |
|---|---|---|
| `usb_devices` | `/sys/bus/usb/devices` | A libusb-based portable backend is feasible (`rusb` crate) but adds a heavy native dep — tracked for future work. |
| `syscall_trace` | eBPF (`raw_syscalls/sys_enter`) via `aya` | eBPF doesn't exist outside Linux. macOS DTrace is deprecated and SIP-restricted on Apple Silicon; Windows would need an ETW provider (`Microsoft-Windows-Kernel-System`). Both are 2-week projects on their own. |

When the LLM calls one of these tools from a macOS or Windows host, it gets a structured "unsupported on this OS" MCP error pointing to this section. No silent failures, no crashes.

### Compile-target verification

```bash
cargo check -p trishul-mcp                                       # native target (linux on this host)
cargo check -p trishul-mcp --target x86_64-pc-windows-gnu        # Windows
cargo check -p trishul-mcp --target x86_64-apple-darwin          # macOS — requires SDK headers locally
```

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
