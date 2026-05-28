# Install & Integration Guide

Trishul ships as a single binary that any MCP-aware Claude client launches over **stdio**. There is no daemon, no service, no port. The client spawns `trishul-mcp` for the duration of the chat session and tears it down when the session ends.

This guide covers:

1. [Install on Linux](#1-linux)
2. [Install on macOS](#2-macos)
3. [Install on Windows](#3-windows)
4. [Wire into Claude Desktop](#4-claude-desktop)
5. [Wire into Claude Code (CLI)](#5-claude-code-cli)
6. [Wire into Cursor / Continue / Zed](#6-cursor--continue--zed)
7. [Use from the Anthropic Agent SDK](#7-anthropic-agent-sdk)
8. [Verify it works](#8-verify-it-works)
9. [Troubleshooting](#9-troubleshooting)
10. [Uninstall](#10-uninstall)

The privilege model for `syscall_trace` is documented separately in [`PRIVILEGES.md`](PRIVILEGES.md). Tool semantics are in [`TOOLS.md`](TOOLS.md). Sample Claude conversations are in [`EXAMPLES.md`](EXAMPLES.md).

---

## 1. Linux

```bash
# 1. Rust toolchain (stable + nightly + the BPF linker)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup toolchain install nightly --component rust-src
cargo install bpf-linker

# 2. Build + install Trishul
git clone <your-fork>/trishul.git && cd trishul
cargo install --path crates/trishul-mcp
# → ~/.cargo/bin/trishul-mcp
```

Confirm:

```bash
trishul-mcp selftest
# expect one "ok" line per tool; syscall_trace will report a setcap hint
# unless you've granted CAP_BPF — see step 3 below
```

### Optional: grant `syscall_trace` privileges once

```bash
sudo setcap cap_bpf,cap_perfmon=eip "$(which trishul-mcp)"
```

The capability is sticky on the binary. After that, `syscall_trace` works from any client, no sudo at runtime. See [`PRIVILEGES.md`](PRIVILEGES.md) for the full story.

### Kernel requirements

- **Linux ≥ 5.8** (BTF + BPF ring buffer required for the tracepoint).
- `/sys/kernel/btf/vmlinux` must exist (most modern distros have it on by default).

---

## 2. macOS

Trishul builds on macOS with the standard Rust toolchain:

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
xcode-select --install   # provides libproc.h headers
git clone <your-fork>/trishul.git && cd trishul
cargo install --path crates/trishul-mcp
# → ~/.cargo/bin/trishul-mcp
```

### `syscall_trace` on macOS

Backend is shell-out to `/usr/sbin/dtrace`. Two privilege scenarios:

| Goal | What to do |
|---|---|
| Trace *your own* non-Apple-signed processes | Launch the MCP client (Claude Desktop, etc.) with `sudo`, **or** run `sudo trishul-mcp serve` and point the client at it. |
| Trace Apple-signed binaries (Safari, Mail, system daemons) | Relax SIP via Recovery: `csrutil enable --without dtrace`. **Security regression — only on a dev box.** Restore with `csrutil enable` once finished. |

Trishul detects both failure modes and returns a clear `RequiresCapability` error pointing back here.

### Tested on

- macOS 14 Sonoma, macOS 15 Sequoia, macOS 26 (latest stable).
- Apple Silicon (M1/M2/M3/M4) and Intel.

---

## 3. Windows

```powershell
# 1. Rust toolchain
winget install --id Rustlang.Rustup -e
rustup toolchain install stable

# 2. Build + install Trishul
git clone <your-fork>/trishul.git
cd trishul
cargo install --path crates/trishul-mcp
# → %USERPROFILE%\.cargo\bin\trishul-mcp.exe
```

> The `trishul-ebpf` sub-crate **only builds on Linux** (it's the kernel BPF object). On Windows the `build.rs` skips it and writes an empty stub. This is expected — `syscall_trace` on Windows uses ETW, not eBPF.

### `syscall_trace` on Windows

Backend is `ferrisetw` (pure-Rust ETW consumer) attached to the **NT Kernel Logger** with the `SystemCall` flag.

Requires **Administrator** (`SeSystemProfilePrivilege`). Two paths:

| Goal | What to do |
|---|---|
| Run trace just for this session | Right-click Claude Desktop / your terminal → **Run as administrator**. |
| Persist privilege for the binary | Use [PsExec](https://learn.microsoft.com/sysinternals/downloads/psexec) or Task Scheduler to launch `trishul-mcp.exe` as `NT AUTHORITY\SYSTEM`. |

Without admin, the tool returns `RequiresCapability("SeSystemProfilePrivilege (run as Administrator) on Windows")`.

### Tested on

- Windows 11 (24H2 and 25H2).
- Windows Server 2022 / 2025.

---

## 4. Claude Desktop

Edit the client's config file:

| OS | Path |
|---|---|
| Linux | `~/.config/Claude/claude_desktop_config.json` |
| macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Windows | `%APPDATA%\Claude\claude_desktop_config.json` |

Add the `trishul` server:

```jsonc
{
  "mcpServers": {
    "trishul": {
      "command": "trishul-mcp"
    }
  }
}
```

GUI applications often don't inherit your shell's `PATH`. If you see "command not found", use the absolute path instead:

```jsonc
{
  "mcpServers": {
    "trishul": {
      // Linux / macOS:
      "command": "/Users/YOU/.cargo/bin/trishul-mcp"
      // Windows: "command": "C:\\Users\\YOU\\.cargo\\bin\\trishul-mcp.exe"
    }
  }
}
```

**Restart Claude Desktop.** You'll see a 🔌 picker offering the `trishul` tools. Ask:

> "What's listening on port 5432?"

---

## 5. Claude Code (CLI)

Project-local (preferred):

```bash
mkdir -p .claude
cat > .claude/config.json <<'EOF'
{
  "mcpServers": {
    "trishul": { "command": "trishul-mcp" }
  }
}
EOF
```

Or globally:

```bash
mkdir -p ~/.claude
# same JSON in ~/.claude/config.json
```

Tools become available the next time you run `claude` in that directory — no daemon to restart.

---

## 6. Cursor / Continue / Zed

These tools share the MCP server shape.

**Cursor** — `~/.cursor/mcp.json`:
```json
{ "mcpServers": { "trishul": { "command": "trishul-mcp" } } }
```

**Continue** — in your Continue config (`~/.continue/config.json`):
```json
{
  "experimental": {
    "modelContextProtocolServers": [
      { "transport": { "type": "stdio", "command": "trishul-mcp" } }
    ]
  }
}
```

**Zed** — `~/.config/zed/settings.json`:
```json
{
  "context_servers": {
    "trishul": { "command": { "path": "trishul-mcp", "args": [] } }
  }
}
```

---

## 7. Anthropic Agent SDK

```python
# Python; the JS/TS SDK is structurally identical.
from anthropic import Anthropic

client = Anthropic()
response = client.messages.create(
    model="claude-opus-4-7",
    max_tokens=1024,
    mcp_servers=[{
        "type": "stdio",
        "name": "trishul",
        "command": "trishul-mcp",
    }],
    messages=[{"role": "user", "content": "What's eating CPU on my box right now?"}],
)
print(response.content)
```

The SDK spawns `trishul-mcp` as a subprocess for the lifetime of the request and tears it down afterward.

---

## 8. Verify it works

The `selftest` subcommand runs every tool once locally — no client needed:

```bash
trishul-mcp selftest
# Linux example:
#   · deva-linux · Ubuntu 24.04 · 16 CPUs (Ryzen 9 9800X3D) · 62.2 GiB RAM · load 0.45
#   ok    host_info                      125µs
#   ok    process_tree                   7ms
#   ok    proc_snapshot                  5ms
#   ok    process_detail_self            500µs
#   ok    network_listeners              12ms
#   ok    usb_devices                    26ms
#   ok    syscall_trace                  46µs   (or skip + setcap hint)
```

You can also speak MCP by hand to inspect schemas:

```bash
( echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"0.0.0"}}}'
  echo '{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}'
  echo '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
) | trishul-mcp serve
```

You should see three JSON responses on stdout: the server identity, the full tool catalog with input schemas, and an empty acknowledgement for the notification.

---

## 9. Troubleshooting

### "trishul-mcp not found" in Claude Desktop

GUI apps don't source your shell rc. Use the absolute path: `which trishul-mcp` → paste that into the config.

### `syscall_trace` returns `RequiresCapability`

This is intentional — Trishul refuses to silently fail. See [`PRIVILEGES.md`](PRIVILEGES.md) for the exact `setcap` / `sudo` / Run-as-Administrator command per OS.

### "No GPU adapter" / WebGPU errors

You're in the wrong project. That's Yantra, the WebGPU sim. Trishul has no GPU dependency.

### Empty output / no listeners visible

`network_listeners` can only attribute PIDs you have read permission on. Run the client as your own user; cross-user PIDs appear with `pid: null, comm: null`.

### Slow tool responses

The first call after install runs `cargo build` artefacts cold. Subsequent calls are <100 ms on every tool except `syscall_trace`, which is bounded by `duration_ms` (default 1 s, clamped to 30 s).

### Build hack: `permission denied` on Linux build scripts

If your project tree is on a `noexec` filesystem (common with FUSE-mounted external drives), cargo can't execute build scripts. Either move the project off the mount, or build with `CARGO_TARGET_DIR=/tmp/trishul-target` to put compile artefacts on `/tmp`.

### My MCP client doesn't show Trishul's tools

1. Confirm `trishul-mcp selftest` works.
2. Confirm the JSON config validates (`jq . path/to/config.json`).
3. Inspect the client's MCP logs — Claude Desktop has a "View Logs" menu item.
4. Run the by-hand wire test from §8 to confirm the binary speaks valid JSON-RPC.

---

## 10. Uninstall

```bash
cargo uninstall trishul-mcp
```

Remove the `trishul` entry from your client's MCP config. There is nothing else — no daemon, no service, no autostart entry.
