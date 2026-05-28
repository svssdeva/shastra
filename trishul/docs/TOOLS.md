# Trishul tool catalog

Every Trishul tool returns the same envelope:

```json
{
  "summary": "<one-line human synthesis>",
  "data": { ... },
  "warnings": ["..."],
  "truncated": false
}
```

`summary` is what Claude will quote back to you. `data` is the full payload for follow-up reasoning. `warnings` capture per-item permission gaps and missing optional tools. `truncated` is set when the result hit a hard cap.

---

## `host_info`

**Args:** none.

**Returns:** kernel release/version, arch, distro, hostname, uptime, load averages, memory (total/available/free/swap), CPU count.

Sample summary:
> `deva-linux · Zorin OS 18.1 · kernel 6.17.0-29-generic · 16 CPUs · 62.2 GiB RAM (54.3 free) · load 3.64`

Ask Claude:
> "What kind of machine am I on?"
> "Is the box swapping?"

---

## `process_tree`

**Args:**
| name | type | default | meaning |
|---|---|---|---|
| `root_pid` | int | `1` | Root of the subtree to return |
| `max_nodes` | int | `5000` | Hard cap; sets `truncated: true` if exceeded |

**Returns:** nested tree. Each node has `pid`, `ppid`, `comm`, `cmdline`, `exe`, `uid`, `user`, `state`, `rss_kb`, `vsz_kb`, `threads`, and a `children` array.

Ask Claude:
> "Show me the descendants of pid 1234."
> "How many threads is Chrome running and where are they?"

---

## `proc_snapshot`

**Args:**
| name | type | default | meaning |
|---|---|---|---|
| `sort_by` | string | `"rss"` | `"rss"` or `"cpu"` (cpu sampling is best-effort in v1; deferred to v2) |
| `limit` | int | `30` | Cap on processes returned |

**Returns:** a flat list of the top-N processes with the same per-process fields as `process_tree`.

Ask Claude:
> "What's eating my memory?"
> "Top 10 processes please."

---

## `process_detail`

**Args:**
| name | type | required | meaning |
|---|---|---|---|
| `pid` | int | yes | Target PID |

**Returns:** `pid`, `comm`, `cmdline`, `exe`, `cwd`, full `status` block, and `env` (when permitted). When `env` cannot be read (kernel blocks cross-user access), the field is `null` and a warning is emitted.

Ask Claude:
> "What's pid 4242 doing? Show me its environment."

---

## `network_listeners`

**Args:** none.

**Returns:** array of TCP and UDP sockets in `LISTEN` (or all UDP, since UDP doesn't have a LISTEN state). Each entry:

```json
{
  "proto": "tcp" | "tcp6" | "udp" | "udp6",
  "local_addr": "127.0.0.1",
  "local_port": 5432,
  "inode": 1234567,
  "uid": 1000,
  "pid": 4242,        // null if owning process is in another user namespace
  "comm": "postgres"  // null if pid is null
}
```

Ask Claude:
> "Anything listening on port 5432?"
> "Which process owns the socket on 0.0.0.0:80?"

---

## `usb_devices`

**Args:** none.

**Returns:** array of USB devices visible at `/sys/bus/usb/devices`. Each entry includes `id_vendor`, `id_product`, `manufacturer`, `product`, `bus`, `dev_num`, `speed_mbps`. Vendor and product **names** are resolved against `/usr/share/hwdata/usb.ids` (or `/usr/share/misc/usb.ids`) when available; if missing, a warning is emitted but the ID hex values still flow through.

Ask Claude:
> "What's plugged in via USB?"
> "Is my Yubikey detected?"

---

## Deferred (Phase 5+)

These tools are designed in the spec but not yet implemented:

- `syscall_trace` — eBPF tracepoint snapshot of recent syscalls for a PID. Needs `CAP_BPF`.
- `gpu_telemetry` — NVIDIA (NVML), AMD (sysfs `hwmon`), Intel (sysfs).
- `block_devices` — disks, partitions, filesystems, SMART summary if `smartctl` is present.

Track progress at [the implementation plan](../../docs/superpowers/plans/2026-05-28-trishul.md).

---

## Error semantics

Trishul **never panics**. Permission gaps surface as `warnings`, not failures. Missing optional dependencies (e.g., `usb.ids`) surface as warnings, not errors. The only structured errors that fail a tool call are:

- `BadArgs(msg)` — invalid input (e.g., `process_detail` with a non-existent PID).
- `RequiresCapability(cap)` — only thrown by Phase-5 eBPF tools when running without `CAP_BPF`.

A failed tool call is returned to the LLM as a normal MCP error response so Claude can react to it intelligently.
