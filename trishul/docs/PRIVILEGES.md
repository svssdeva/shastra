# Privilege Model

Trishul is designed to **need no privileges for 6 of its 7 tools**. The seventh — `syscall_trace` — needs OS-level tracing rights that differ per platform.

This document collects the privilege story in one place so you don't have to dig through three OS-vendor manuals.

## Cheat sheet

| Tool | Linux | macOS | Windows |
|---|---|---|---|
| `host_info` | none | none | none |
| `process_tree` | none | none | none |
| `proc_snapshot` | none | none | none |
| `process_detail` | none (env may be hidden for cross-user PIDs) | none | none |
| `network_listeners` | none (PID resolution capped to your own user) | none | none |
| `usb_devices` | none | none | none |
| `syscall_trace` | `CAP_BPF` + `CAP_PERFMON` | `sudo` + SIP-aware | Administrator (`SeSystemProfilePrivilege`) |

If `syscall_trace` fails because of insufficient privilege, Trishul returns a structured `RequiresCapability` error whose message contains the exact remediation command — you should never see a raw kernel `errno` or a confusing crash.

---

## Linux: granting `CAP_BPF` + `CAP_PERFMON`

The eBPF backend needs to load a BPF program (`CAP_BPF`) and attach a tracepoint (`CAP_PERFMON`). There are three ways to grant these:

### A. File capability (preferred — no sudo at runtime)

```bash
sudo setcap cap_bpf,cap_perfmon=eip "$(which trishul-mcp)"
```

The capability is **sticky on the binary**: any user can now invoke `syscall_trace` through any MCP client. This is the right setup for a single-user dev machine.

`setcap` flags decoded:
- `cap_bpf` = the capability we want.
- `cap_perfmon` = required for `EVENT_TRACE_FLAG_SYSTEMCALL` and tracepoint attach.
- `e` = effective (use immediately on exec).
- `i` = inheritable (passes to spawned processes).
- `p` = permitted (the bound set).

Verify:
```bash
getcap "$(which trishul-mcp)"
# /home/.../trishul-mcp cap_bpf,cap_perfmon=eip
```

> **tracefs caveat (Ubuntu/Zorin and other locked-down distros).** `CAP_BPF` +
> `CAP_PERFMON` grant the bpf/perf *syscalls*, but **not** filesystem DAC. Attaching
> the tracepoint reads `/sys/kernel/tracing/events/raw_syscalls/sys_enter/id`, which
> ships as `0440 root:root` on some distros. A non-root process then fails with
> `attach BPF: .../sys_enter/id` (permission denied) **even with the caps above**.
> Options, narrowest first:
> - **Verify / occasional use:** run under `sudo` (option B) — root bypasses the DAC.
> - **Persistent, narrower-than-root:** `sudo chmod -R o+rX /sys/kernel/tracing/events`
>   (resets on reboot/remount; persist via a `systemd-tmpfiles` or `udev` rule).
> - **Persistent, broad — not recommended for an MCP server:** add `cap_dac_override`
>   (`setcap cap_bpf,cap_perfmon,cap_dac_override=eip`). This lets the (LLM-driven)
>   binary bypass *all* file permissions — treat as a real escalation.
>
> Distros that mount tracefs world-readable (id files `0444`) need none of this.

### B. Per-session `sudo`

```bash
sudo trishul-mcp serve
```

Then point your MCP client at the running `sudo`'d binary. Less clean than (A) — every client launch needs the password.

### C. Run-as-root container

If you're running Trishul in Docker / Podman, give the container these caps:

```bash
docker run --cap-add BPF --cap-add PERFMON ...
```

### Kernel prerequisites

- **Linux ≥ 5.8** (BTF + BPF ring buffer + `CAP_BPF` separation from `CAP_SYS_ADMIN`).
- `/sys/kernel/btf/vmlinux` must exist.
- Unprivileged BPF must not be hard-disabled (`kernel.unprivileged_bpf_disabled = 2` blocks the path even with `CAP_BPF`). Most distros leave this at 1, which is fine for us.

---

## macOS: SIP and DTrace

The macOS backend is the **only deliberate shell-out** in Trishul. It invokes `/usr/sbin/dtrace` with a tight D script that exits at the requested duration.

### Why this is messy

Apple deprecated DTrace as a recommended tool around macOS 10.11. On modern macOS (especially Apple Silicon), **System Integrity Protection (SIP)** restricts DTrace from observing Apple-signed binaries.

The good news: SIP does **not** block DTrace from observing your own non-Apple-signed processes — *as long as you're root*.

### A. Trace your own processes

```bash
sudo trishul-mcp serve
```

That's the entire setup, if you only need to observe processes you own. Works on stock macOS with full SIP enabled.

### B. Trace Apple-signed binaries (Safari, system daemons, …)

You need to relax SIP. **This is a security regression — do it only on a development machine, and restore SIP when done.**

```bash
# Reboot into Recovery (Apple Silicon: hold Power; Intel: ⌘R during boot)
# Open Terminal from the menu bar, then:
csrutil enable --without dtrace
# Reboot. Trishul can now sees Apple-signed processes.
```

To restore:

```bash
# Reboot into Recovery → Terminal
csrutil enable
# Reboot.
```

### How Trishul handles failure

When `dtrace` exits with `dtrace_dof_init` / `system integrity protection` / `not privileged` / `permission denied` in its stderr, Trishul returns:

```
RequiresCapability("sudo (and SIP-allowing target); on macOS see README → macOS DTrace setup")
```

The LLM can recognise this and prompt the user.

---

## Windows: ETW and `SeSystemProfilePrivilege`

The Windows backend is **pure native ETW** via the `ferrisetw` crate — no shell-outs.

### What's needed

Starting an **NT Kernel Logger** session requires:

- Membership in the **Administrators** group, *or*
- Membership in the **Performance Log Users** group (built-in), *or*
- The `SeSystemProfilePrivilege` user right.

In practice, the simplest path is to run the MCP client as administrator:

```
Right-click Claude Desktop → Run as administrator
```

Trishul-mcp is launched as a child of Claude Desktop and inherits the privilege.

### Persisting privilege via Task Scheduler

If you'd rather not run Claude Desktop as Administrator daily:

```powershell
# Run as Administrator once:
schtasks /create /tn "Trishul MCP" /tr "C:\Users\YOU\.cargo\bin\trishul-mcp.exe serve" `
  /sc onlogon /rl HIGHEST /f
```

Then configure your MCP client to connect to that running instance. (Caveat: stdio MCP is per-process; this works best when you wrap the scheduled task to pipe into the client manually. Most users prefer the simple "run client as admin" path.)

### How Trishul handles failure

When `EnableTrace` returns `ERROR_ACCESS_DENIED` (Win32 error 5), Trishul detects it in the `TraceError` debug output and returns:

```
RequiresCapability("SeSystemProfilePrivilege (run as Administrator) on Windows")
```

---

## Why Trishul doesn't drop privileges itself

A common request: "Have the MCP server start as root, then drop down to my user."

That's reasonable for daemons but counter-productive for stdio MCP servers:

1. The server's lifetime is the **chat session**. It dies when the client disconnects. There's no long-lived attack surface to drop privileges *to*.
2. The privileged operations (`CAP_BPF`, `dtrace`, ETW) happen for the duration of a single tool call. Dropping privileges between calls would force re-acquiring them, which needs the privilege you just gave up.
3. The capability model (file capabilities on Linux, Run-as-Administrator on Windows) already produces the right grant scope — exactly the privilege needed, no more.

If you want defence-in-depth, run Trishul under a [`bubblewrap`](https://github.com/containers/bubblewrap)-style sandbox or in a Docker container with only the necessary capabilities added.

---

## Audit & observability

You can confirm what Trishul actually requested:

- **Linux**: `dmesg` or `journalctl -k` will show BPF verifier output if you set `RUST_LOG=aya=debug` and look at the stderr of `trishul-mcp`.
- **macOS**: every `dtrace` invocation logs to `log show --predicate 'subsystem == "com.apple.dtrace"'`.
- **Windows**: ETW sessions are visible in `logman query -ets`.

Trishul logs all collector starts/stops to stderr via `tracing` (info level by default). The stdout channel is reserved for JSON-RPC frames — no operational noise leaks into protocol traffic.
