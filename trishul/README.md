# Trishul

> A Rust MCP server that gives Claude a **body in your Linux machine** — live process tree, network listeners, USB topology, GPU telemetry — without parsing `ps` output.

See `../docs/superpowers/specs/2026-05-28-trishul-design.md` for the full design.

## Quick start

```bash
cargo install --path crates/trishul-mcp
# add to ~/.config/Claude/claude_desktop_config.json:
#   { "mcpServers": { "trishul": { "command": "trishul-mcp" } } }
```

Restart Claude Desktop / Code, then ask:

> What's eating my CPU?
> Anything listening on port 5432?
> What's plugged in via USB?

## Selftest

```bash
trishul-mcp selftest
```

Exercises every tool and prints pass/fail.
