# Example Conversations

A gallery of real prompts you can throw at Claude after wiring Trishul in. Each example shows the prompt, the tool(s) Claude is likely to call, and what the response looks like.

## "What kind of machine am I on?"

**Triggers:** `host_info`

> **Claude:** You're on `deva-linux`, running Ubuntu 24.04 (kernel 6.17.0-29-generic) on an x86_64 AMD Ryzen 9 9800X3D with 16 cores. You have 62.2 GiB of RAM with 53.4 GiB available, no swap pressure, and a 1-minute load average of 0.85 — the box is essentially idle.

---

## "What's eating my CPU right now?"

**Triggers:** `proc_snapshot` with `sort_by: "cpu"`

> **Claude:** The top CPU consumer is `firefox-bin` (pid 4231) at 38% CPU and 4.1 GiB RSS, followed by `gnome-shell` at 9%, then `WindowServer` at 6%. Most other processes are idle. If something feels sluggish, Firefox is the load.

---

## "Anything listening on port 5432?"

**Triggers:** `network_listeners`

> **Claude:** Yes — `postgres` (pid 1234) is listening on `127.0.0.1:5432` and `::1:5432`. It's bound only to localhost, so nothing outside this machine can reach it.

---

## "What's plugged in via USB right now?"

**Triggers:** `usb_devices`

> **Claude:** 15 USB devices. The notable ones:
> - **Yubico YubiKey 5 OTP+FIDO+CCID** (vendor 0x1050, full speed)
> - **Logitech MX Master 3** mouse (high speed)
> - **Apple Magic Keyboard** (low speed)
> - **DisplayLink USB-C dock** with 4 downstream devices
> - The rest are USB root hubs and the built-in webcam/Bluetooth adapter.

---

## "Walk me through what docker is doing"

**Triggers:** `process_tree` with the docker daemon's PID

> **Claude:** `dockerd` (pid 891) has 12 descendants right now: 4 `containerd-shim` processes, each rooting a running container. The biggest by RAM is the `postgres:16` container at 240 MB RSS; the others are an `nginx:latest` reverse proxy (8 MB) and two `redis:7` instances (~12 MB each). No zombie children.

---

## "Show me everything about pid 4242"

**Triggers:** `process_detail` with `pid: 4242`

> **Claude:** Pid 4242 is `postgres` (Worker), parent pid 1234. It's running as user `postgres` from `/usr/lib/postgresql/16/bin/postgres`, working directory `/var/lib/postgresql/16/main`. RSS 240 MB, CPU 0.2%, up for 53 minutes. Status: Sleep. Environment is hidden (we don't have permission on the postgres user's env), so I can only show command-line args: `… --config-file=/etc/postgresql/16/main/postgresql.conf`.

---

## "Is pid 4242 spinning on epoll? Trace it for 2 seconds"

**Triggers:** `syscall_trace` with `pid: 4242, duration_ms: 2000`

> **Claude:** Over 2 seconds, pid 4242 issued 8,124 syscalls. The distribution: `epoll_wait` 5,103, `recvfrom` 1,802, `sendto` 1,201, others <50 each. Yes — it's spinning on `epoll`, which is normal for an idle postgres worker waiting on a connection. If it was busy serving queries you'd see `read`/`write`/`pread64` dominate.

---

## "Which processes are doing the most file I/O?"

**Triggers:** `syscall_trace` with no `pid` filter, then post-processing in the LLM

> **Claude:** Tracing for 1 second across all PIDs (412,318 total syscalls):
>
> | Process | read/write/pread64 calls/sec |
> |---|---|
> | `firefox-bin` (4231) | 18,934 |
> | `dockerd` (891) | 4,201 |
> | `postgres` (1234) | 1,802 |
>
> Firefox is by far the busiest; this is consistent with normal browser activity (cache I/O + service workers). Nothing here looks pathological.

---

## "Is the box swapping?"

**Triggers:** `host_info`

> **Claude:** No swap is in use right now — swap is configured at 4 GiB total, 0 used. With 53.4 GiB of free RAM, you're nowhere near memory pressure.

---

## "Which process is using the most memory and can I safely kill it?"

**Triggers:** `proc_snapshot` (sort_by rss) + `process_detail`

> **Claude:** Top RSS is `firefox-bin` (pid 4231) at 4.1 GiB. It's owned by your user (`deva`), parent is `gnome-session`. It's not held open by any unsaved work I can detect from the cmdline (no `--profile=*` arg pointing at an active session lock). Closing Firefox normally is safer than `kill` because of session restore data, but `kill 4231` will work — you'd lose any unsaved typing in form fields.

---

## "Spot anything weird"

**Triggers:** `host_info`, then `proc_snapshot`, then maybe `network_listeners` and `syscall_trace` depending on what looks off

> **Claude:** A quick sweep:
> - Host: nothing alarming. Load 0.85, RAM 14% used, no swap.
> - Top processes: Firefox at 38% CPU is the only one above 5% — normal.
> - Listeners: 17 sockets, all bound to localhost or a private LAN interface (no surprise public ports).
> - One thing to flag: there's a process `python3` (pid 9821) at 1.2 GiB RSS running `/tmp/build_artifacts/foo.py`. Running long-lived Python from `/tmp` is unusual — worth a look at whether that's intentional.

---

## Tips for asking Claude

- **Be specific about scope.** "What's running" produces a 17-node tree summary; "what's running under pid 1234" produces a focused walk.
- **Use durations sparingly for `syscall_trace`.** 500-1000 ms is enough to see the working pattern. Going above 5 seconds returns a lot of data without much extra signal.
- **Ask for follow-ups.** Claude has the whole `data` field, so "now show me only the python processes" or "what's the parent of that?" works without re-tracing.
- **`summary_only: true`** in your prompt (or just say "just give me the count") will cause Claude to add `summary_only: true` to the tool call, which drops the heavy payload entirely.
