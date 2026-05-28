# Tool Catalog

Every Trishul tool returns the same response envelope:

```json
{
  "summary": "<one-line human synthesis>",
  "data":    { ... },
  "warnings": [],
  "truncated": false
}
```

`summary` is what Claude will quote back to you. `data` is the structured payload for follow-up reasoning. `warnings` capture per-item permission gaps and missing optional sources without failing the whole call. `truncated` is set when the result hit a hard cap.

Every tool accepts `summary_only: true` to drop the `data` field entirely (useful for "is there anything?" probes). The server enforces a **20 KB hard budget** on every response; oversize `data` is replaced with a stub pointing the LLM to narrower args.

| Tool | Platforms | Privileges |
|---|---|---|
| [`host_info`](#host_info) | linux · macos · windows | userspace |
| [`process_tree`](#process_tree) | linux · macos · windows | userspace |
| [`proc_snapshot`](#proc_snapshot) | linux · macos · windows | userspace |
| [`process_detail`](#process_detail) | linux · macos · windows | userspace |
| [`network_listeners`](#network_listeners) | linux · macos · windows | userspace |
| [`usb_devices`](#usb_devices) | linux · macos · windows | userspace |
| [`syscall_trace`](#syscall_trace) | linux · macos · windows | privileged (per OS) |

---

## `host_info`

Snapshot of the host machine. Cheap (~100 µs).

**Args:** none beyond `summary_only`.

**Returns:**

```json
{
  "summary": "deva-linux · Ubuntu 24.04 · 16 CPUs (Ryzen 9 9800X3D) · 62.2 GiB RAM (53.7 avail) · load 0.85",
  "data": {
    "hostname": "deva-linux",
    "os_name": "Linux",
    "os_version": "24.04",
    "kernel_version": "6.17.0-29-generic",
    "arch": "x86_64",
    "distribution_id": "ubuntu",
    "uptime_secs": 4521,
    "load": [0.85, 0.62, 0.50],
    "mem_total_kb": 65197284,
    "mem_available_kb": 56383200,
    "mem_used_kb": 8814084,
    "swap_total_kb": 4194300,
    "swap_used_kb": 0,
    "cpu_count": 16,
    "cpu_brand": "AMD Ryzen 9 9800X3D 8-Core Processor"
  }
}
```

**Ask Claude:**
> "What kind of machine am I on?"
> "Is the box swapping?"
> "How many cores does this machine have?"

---

## `process_tree`

A nested process tree rooted at any PID. Default root is **PID 1** (init/launchd) on Linux/macOS, **PID 0** on Windows. Default cap **500 nodes** to keep responses light.

**Args:**

| name | type | default | meaning |
|---|---|---|---|
| `root_pid` | uint | `1` (linux/macos) / `0` (windows) | Root PID to walk from |
| `max_nodes` | uint | `500` | Hard cap; sets `truncated: true` if exceeded |
| `summary_only` | bool | `false` | Drop the `data` field |

**Returns:** a tree where each node has `pid`, `ppid`, `name`, `cmdline`, `exe`, `uid`, `user`, `status`, `rss_kb`, `virt_kb`, `cpu_pct`, `run_time_secs`, and a `children` array.

```json
{
  "summary": "process tree rooted at pid 1 (systemd): 187 nodes",
  "data": {
    "pid": 1,
    "ppid": 0,
    "name": "systemd",
    "cmdline": ["/sbin/init", "splash"],
    "exe": "/usr/lib/systemd/systemd",
    "user": "root",
    "uid": "0",
    "status": "Sleep",
    "rss_kb": 18432,
    "cpu_pct": 0.0,
    "run_time_secs": 4521,
    "children": [ /* ... */ ]
  }
}
```

**Ask Claude:**
> "Show me everything spawned by docker."
> "How many threads is Chrome running?"
> "Walk the descendants of PID 1234."

---

## `proc_snapshot`

Flat top-N list, sorted by RSS or CPU.

**Args:**

| name | type | default | meaning |
|---|---|---|---|
| `sort_by` | string | `"rss"` | `"rss"` or `"cpu"` |
| `limit` | uint | `20` | Hard-capped at **100** |
| `summary_only` | bool | `false` | Drop the `data` field |

**Returns:** `{ "processes": [...] }` with the same per-process shape as `process_tree` nodes (minus children).

**Ask Claude:**
> "What's eating my memory?"
> "Top 10 processes by CPU."
> "Anything chewing more than 1 GB of RAM?"

---

## `process_detail`

Deep view of one PID.

**Args:**

| name | type | required | meaning |
|---|---|---|---|
| `pid` | uint | yes | Target PID |
| `summary_only` | bool | no | Drop the `data` field |

**Returns:** `pid`, `ppid`, `name`, `cmdline`, `exe`, `cwd`, `status`, `rss_kb`, `virt_kb`, `cpu_pct`, `run_time_secs`, `user`, `uid`, `env`.

The `env` field is **capped at 100 vars × 256 bytes per value** to keep responses bounded; oversize values get an inline truncation marker (`"…(X bytes total)"`). When the kernel hides the env (cross-user, root-owned process), `env: null` and a `warnings` entry explains why.

**Ask Claude:**
> "What's pid 4242 doing? Show me its environment."
> "Where is the postgres process running from?"
> "Is there a `--verbose` flag in the chrome PID's args?"

---

## `network_listeners`

TCP and UDP sockets in `LISTEN` state (UDP doesn't have a LISTEN state — all UDP sockets are returned). Hard-capped at **500** entries.

**Args:** none beyond `summary_only`.

**Returns:**

```json
{
  "summary": "17 listening socket(s) (6 resolved to PIDs)",
  "data": {
    "listeners": [
      { "proto": "tcp",  "local_addr": "127.0.0.1", "local_port": 5432, "pid": 1234, "comm": "postgres" },
      { "proto": "tcp6", "local_addr": "::1",       "local_port": 631,  "pid": 567,  "comm": "cupsd" }
    ]
  }
}
```

`pid: null` and `comm: null` appear when the socket belongs to a process you don't have read permission on (typically other users / root).

**Ask Claude:**
> "Anything listening on port 5432?"
> "What's bound to 0.0.0.0?"
> "Which process owns the SSH socket?"

---

## `usb_devices`

USB topology via the pure-Rust `nusb` crate. Cross-platform: `usbfs` on Linux, IOKit on macOS, WinUSB on Windows.

**Args:** none beyond `summary_only`.

**Returns:**

```json
{
  "summary": "15 USB device(s) detected",
  "data": {
    "devices": [
      {
        "bus_id": "1",
        "addr": 3,
        "id_vendor": "1050",
        "id_product": "0407",
        "vendor_name": "Yubico.com",
        "product_name": "Yubikey 5 OTP+FIDO+CCID",
        "manufacturer": "Yubico",
        "product": "YubiKey OTP+FIDO+CCID",
        "serial": "13456789",
        "class": 0,
        "subclass": 0,
        "protocol": 0,
        "speed": "full (12 Mbps)"
      }
    ]
  }
}
```

Vendor / product **names** come from two sources, prefer first:
1. The USB descriptor strings the device itself supplies (works on every OS, no extra files).
2. `/usr/share/hwdata/usb.ids` (or `/var/lib/usbutils/usb.ids`) — extra polish on Linux, harmless if missing.

**Ask Claude:**
> "Is my Yubikey detected?"
> "What's plugged in via USB right now?"
> "Show me the speeds of every USB device."

---

## `syscall_trace`

Per-PID syscall counts over a window. **Privileged on every OS** — see [`PRIVILEGES.md`](PRIVILEGES.md).

**Args:**

| name | type | default | meaning |
|---|---|---|---|
| `duration_ms` | uint | `1000` | Trace window, clamped to `[10, 30000]` |
| `top_per_pid` | uint | `10` | Syscalls per PID, clamped to `[1, 50]` |
| `pid` | uint? | unset | Filter to one PID |
| `summary_only` | bool | `false` | Drop the `data` field |

**Returns:**

```json
{
  "summary": "47 PID(s) traced over 1.0s — 412318 total syscalls via ebpf (raw_syscalls/sys_enter)",
  "data": {
    "backend": "ebpf (raw_syscalls/sys_enter)",
    "duration_secs": 1.0,
    "total_calls": 412318,
    "pids_traced": 47,
    "by_pid": [
      {
        "pid": 1234,
        "comm": "postgres",
        "total": 91234,
        "top": [
          { "nr": 232, "name": "epoll_wait", "count": 41021 },
          { "nr": 0,   "name": "read",       "count": 18934 },
          { "nr": 1,   "name": "write",      "count": 12001 }
        ]
      }
    ]
  }
}
```

**Backends:**

| OS | Backend | Syscall name resolution |
|---|---|---|
| Linux | `aya` / eBPF `raw_syscalls/sys_enter` | Built-in x86_64 syscall table |
| macOS | shell-out to `/usr/sbin/dtrace` | DTrace returns the C function name directly (`probefunc`) |
| Windows | `ferrisetw` / NT Kernel Logger `SystemCall` | Hex address of the kernel routine (PDB-based symbol resolution is a future addition) |

**Ask Claude:**
> "Is pid 4242 spinning on epoll right now? Trace it for 2 seconds."
> "Which processes are doing the most file I/O?"
> "Sample syscalls system-wide for half a second and tell me what stands out."

---

## Error semantics

Trishul **never panics**. Two structured error variants reach the LLM:

- **`BadArgs(msg)`** — invalid input (e.g. `process_detail` with a non-existent PID). The LLM can correct and retry.
- **`RequiresCapability(cap)`** — `syscall_trace` only, when the host lacks the necessary privilege. The error message includes the exact command to fix it (`setcap` / `sudo` / Run-as-Administrator).

Permission gaps and missing optional dependencies surface as `warnings` on a successful response, not as errors. Out-of-budget responses have a stub `data` with a recoverable hint and `truncated: true`.

## Deferred tools

- `gpu_telemetry` — NVIDIA NVML on all OSes, AMD/Intel via sysfs/IOKit/PDH.
- `block_devices` — disks, partitions, filesystems, SMART summary.
