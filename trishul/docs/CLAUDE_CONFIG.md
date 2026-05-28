# Wiring Trishul into Claude clients

Trishul speaks **MCP over stdio**. Every Claude client that supports MCP servers can use it: Claude Desktop, Claude Code (CLI), the Claude Agent SDK, and IDE integrations that follow the same config shape (Cursor, Continue, Zed).

## 1. Install the binary

```bash
git clone <your-fork>/trishul
cd trishul
cargo install --path crates/trishul-mcp
# → ~/.cargo/bin/trishul-mcp
```

Confirm with:
```bash
trishul-mcp selftest
```

You should see one `ok` line per tool. If anything says `FAIL`, fix the cause before wiring it up — Claude will get the same errors.

> **Build hack (developer machines on noexec filesystems):** if cargo complains about "permission denied" on build scripts, your project tree is mounted `noexec`. Either move the project to a normal partition, or build with `CARGO_TARGET_DIR=/tmp/trishul-target` and reference that binary path in the configs below.

## 2. Claude Desktop

Edit `~/.config/Claude/claude_desktop_config.json` (Linux) or `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS). Add the `trishul` server:

```json
{
  "mcpServers": {
    "trishul": {
      "command": "trishul-mcp",
      "args": []
    }
  }
}
```

If `trishul-mcp` is not on the PATH of the Claude Desktop app (it usually isn't, since GUI apps don't source `~/.bashrc`), use the absolute path:

```json
{
  "mcpServers": {
    "trishul": {
      "command": "/home/YOURUSER/.cargo/bin/trishul-mcp"
    }
  }
}
```

Restart Claude Desktop. In the chat composer you should see Trishul's tools available via the 🔌 picker. Ask:

> What's listening on port 5432?

Claude will call `network_listeners` and answer.

## 3. Claude Code (CLI)

Add to `~/.claude/config.json` (or the project-local `.claude/config.json`):

```json
{
  "mcpServers": {
    "trishul": {
      "command": "trishul-mcp"
    }
  }
}
```

Then in any Claude Code session, the tools appear automatically. No restart needed for project-local configs.

## 4. Cursor / Continue / Zed

These tools use the same MCP server shape. The Cursor config lives at `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "trishul": { "command": "trishul-mcp" }
  }
}
```

## 5. Claude Agent SDK (programmatic use)

```python
from anthropic import Anthropic
# pseudocode — see the Agent SDK docs for the exact API surface

agent = Anthropic.agent(
    mcp_servers=[
        {"name": "trishul", "command": "trishul-mcp"}
    ]
)
```

The SDK will spawn `trishul-mcp` as a subprocess for the duration of the session.

## 6. Verifying the wire

Trishul has no daemon. Each client launches it as a fresh subprocess, talks to it over stdin/stdout (JSON-RPC framed by Content-Length per MCP), then closes stdin when the session ends. You can reproduce this by hand:

```bash
( echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"0.0.0"}}}'
  echo '{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}'
  echo '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
) | trishul-mcp serve
```

You should see three JSON responses — server identity, the tool catalog, and the empty notification has no reply.

## 7. Permissions

Most tools work as your normal user — no `sudo`, no `setcap`. They read from `/proc`, `/sys`, and `/etc`. Partial-data cases:

- `process_detail.env` — kernel hides other users' environments. Trishul returns `null` and emits a warning rather than failing.
- `network_listeners` → PID resolution requires reading other users' `/proc/<pid>/fd/`; cross-user PIDs may show as `null`.

**`syscall_trace` is special.** It loads an eBPF tracepoint and needs `CAP_BPF` + `CAP_PERFMON`. Trishul precheck-detects this and returns a structured `RequiresCapability` error pointing the user to:

```bash
sudo setcap cap_bpf,cap_perfmon=eip $(which trishul-mcp)
```

After that, `syscall_trace` works with no `sudo` at runtime — the file capability is sticky.

## 7b. Platform

Trishul builds and runs on Linux, macOS, and Windows. Five of the seven tools (`host_info`, `process_tree`, `proc_snapshot`, `process_detail`, `network_listeners`) are fully cross-platform via the `sysinfo` and `netstat2` crates.

The two Linux-only tools are:

- **`usb_devices`** — Linux reads `/sys/bus/usb`. The crossplat libusb backend is tracked but not shipped.
- **`syscall_trace`** — eBPF doesn't exist outside Linux. Equivalents (DTrace on macOS, ETW on Windows) are deferred.

When invoked on macOS or Windows, those two tools return a structured MCP error so the LLM can react cleanly.

## 8. Stopping & uninstalling

There's nothing to stop — the binary lives only for the lifetime of the client session. To uninstall:

```bash
cargo uninstall trishul-mcp
```

Remove the `trishul` entry from your client's MCP config.
