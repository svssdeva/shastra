//! Phase-5 eBPF syscall trace.
//!
//! Loads a `raw_syscalls/sys_enter` tracepoint that counts every syscall entry,
//! keyed by `(tgid, syscall_id)` in a kernel HashMap. Userspace samples the map
//! after a configurable duration and returns the top syscalls per PID.
//!
//! Requires `CAP_BPF` and `CAP_PERFMON` (or root). If not present, returns a
//! structured `RequiresCapability` error pointing the user to `setcap`.

#![cfg(target_os = "linux")]

use std::collections::HashMap as StdMap;
use std::time::Duration;

use aya::Ebpf;
use aya::maps::HashMap as BpfHashMap;
use aya::programs::TracePoint;
use nix::libc;
use serde::Serialize;
use serde_json::json;

use crate::types::{CollectorOutput, TrishulError};

const TRISHUL_BPF: &[u8] =
    include_bytes!(concat!(env!("OUT_DIR"), "/trishul-syscall-trace"));

#[derive(Debug, Serialize)]
struct PidSummary {
    pid: u32,
    comm: Option<String>,
    total: u64,
    top: Vec<SyscallCount>,
}

#[derive(Debug, Serialize)]
struct SyscallCount {
    nr: u32,
    name: &'static str,
    count: u64,
}

/// Run a syscall trace for `duration` and return per-PID top-N syscalls.
///
/// `top_per_pid` = how many distinct syscalls to report per PID (sorted by count desc).
pub async fn collect_syscall_trace(
    duration: Duration,
    top_per_pid: usize,
    pid_filter: Option<u32>,
) -> Result<CollectorOutput, TrishulError> {
    // Precheck: BPF needs root or CAP_BPF + CAP_PERFMON. Bail with a clear error if missing,
    // so the user sees a `setcap` hint instead of a cryptic map/program error.
    if !has_bpf_caps() {
        return Err(TrishulError::RequiresCapability("cap_bpf,cap_perfmon"));
    }

    // Load the BPF program embedded at build time.
    let mut bpf = Ebpf::load(TRISHUL_BPF).map_err(|e| map_load_err(&e))?;

    // Attach the tracepoint. This is where CAP_BPF is enforced.
    let program: &mut TracePoint = bpf
        .program_mut("trishul_sys_enter")
        .ok_or_else(|| TrishulError::Procfs("trishul_sys_enter program not found in BPF object".into()))?
        .try_into()
        .map_err(|e: aya::programs::ProgramError| {
            TrishulError::Procfs(format!("program type mismatch: {e}"))
        })?;
    program.load().map_err(|e| map_program_err(&e))?;
    program
        .attach("raw_syscalls", "sys_enter")
        .map_err(|e| map_program_err(&e))?;

    // Sample for the requested duration.
    tokio::time::sleep(duration).await;

    // Read the kernel HashMap.
    let counts: BpfHashMap<_, u64, u64> = BpfHashMap::try_from(
        bpf.map("SYSCALL_COUNTS")
            .ok_or_else(|| TrishulError::Procfs("SYSCALL_COUNTS map not found".into()))?,
    )
    .map_err(|e| TrishulError::Procfs(format!("open BPF map: {e}")))?;

    let mut by_pid: StdMap<u32, Vec<SyscallCount>> = StdMap::new();
    for entry in counts.iter() {
        let (key, count) = entry.map_err(|e| TrishulError::Procfs(format!("map iter: {e}")))?;
        let pid = (key >> 32) as u32;
        let nr = (key & 0xffff_ffff) as u32;
        if let Some(p) = pid_filter
            && pid != p
        {
            continue;
        }
        by_pid.entry(pid).or_default().push(SyscallCount {
            nr,
            name: syscall_name_x86_64(nr),
            count,
        });
    }

    // Build summary: top-N per PID, sorted by total desc.
    let mut summaries: Vec<PidSummary> = by_pid
        .into_iter()
        .map(|(pid, mut sys)| {
            sys.sort_unstable_by_key(|s| std::cmp::Reverse(s.count));
            let total: u64 = sys.iter().map(|s| s.count).sum();
            sys.truncate(top_per_pid);
            PidSummary {
                pid,
                comm: comm_for_pid(pid),
                total,
                top: sys,
            }
        })
        .collect();
    summaries.sort_unstable_by_key(|s| std::cmp::Reverse(s.total));

    let pid_count = summaries.len();
    let total_calls: u64 = summaries.iter().map(|s| s.total).sum();

    let summary = format!(
        "{} PID(s) traced over {:.1}s — {} total syscalls",
        pid_count,
        duration.as_secs_f64(),
        total_calls,
    );
    let data = json!({
        "duration_secs": duration.as_secs_f64(),
        "total_calls": total_calls,
        "pids_traced": pid_count,
        "by_pid": summaries,
    });
    Ok(CollectorOutput::new(summary, data))
}

fn map_load_err(e: &aya::EbpfError) -> TrishulError {
    let s = e.to_string();
    if s.contains("Operation not permitted") || s.contains("EPERM") {
        TrishulError::RequiresCapability("cap_bpf,cap_perfmon")
    } else {
        TrishulError::Procfs(format!("load BPF: {s}"))
    }
}

fn map_program_err(e: &aya::programs::ProgramError) -> TrishulError {
    let s = e.to_string();
    if s.contains("Operation not permitted") || s.contains("EPERM") {
        TrishulError::RequiresCapability("cap_bpf,cap_perfmon")
    } else {
        TrishulError::Procfs(format!("attach BPF: {s}"))
    }
}

fn comm_for_pid(pid: u32) -> Option<String> {
    std::fs::read_to_string(format!("/proc/{}/comm", pid))
        .ok()
        .map(|s| s.trim().to_string())
}

/// True if the process has the rights needed to load BPF programs and attach tracepoints.
/// Either:
///   - effective UID is 0 (root), or
///   - effective capability set includes both `CAP_BPF` (39) and `CAP_PERFMON` (38).
///
/// The check reads `/proc/self/status` line `CapEff:`. Kernel constants are stable.
fn has_bpf_caps() -> bool {
    // SAFETY: getuid/geteuid are safe wrappers; we only call libc directly for clarity.
    let euid = unsafe { libc::geteuid() };
    if euid == 0 {
        return true;
    }
    let Ok(status) = std::fs::read_to_string("/proc/self/status") else {
        return false;
    };
    for line in status.lines() {
        if let Some(rest) = line.strip_prefix("CapEff:")
            && let Ok(caps) = u64::from_str_radix(rest.trim(), 16)
        {
            const CAP_BPF: u32 = 39;
            const CAP_PERFMON: u32 = 38;
            return (caps >> CAP_BPF) & 1 == 1 && (caps >> CAP_PERFMON) & 1 == 1;
        }
    }
    false
}

/// Best-effort syscall name table for x86_64 Linux.
/// Only the common ones are mapped; unknowns return "syscall_<n>".
fn syscall_name_x86_64(nr: u32) -> &'static str {
    match nr {
        0 => "read",
        1 => "write",
        2 => "open",
        3 => "close",
        4 => "stat",
        5 => "fstat",
        6 => "lstat",
        7 => "poll",
        8 => "lseek",
        9 => "mmap",
        10 => "mprotect",
        11 => "munmap",
        12 => "brk",
        13 => "rt_sigaction",
        14 => "rt_sigprocmask",
        16 => "ioctl",
        17 => "pread64",
        18 => "pwrite64",
        19 => "readv",
        20 => "writev",
        21 => "access",
        22 => "pipe",
        23 => "select",
        24 => "sched_yield",
        25 => "mremap",
        28 => "madvise",
        32 => "dup",
        33 => "dup2",
        35 => "nanosleep",
        39 => "getpid",
        41 => "socket",
        42 => "connect",
        43 => "accept",
        44 => "sendto",
        45 => "recvfrom",
        46 => "sendmsg",
        47 => "recvmsg",
        56 => "clone",
        57 => "fork",
        59 => "execve",
        60 => "exit",
        61 => "wait4",
        62 => "kill",
        72 => "fcntl",
        78 => "getdents",
        79 => "getcwd",
        83 => "mkdir",
        87 => "unlink",
        89 => "readlink",
        96 => "gettimeofday",
        97 => "getrlimit",
        99 => "sysinfo",
        102 => "getuid",
        104 => "getgid",
        110 => "getppid",
        158 => "arch_prctl",
        201 => "time",
        202 => "futex",
        217 => "getdents64",
        228 => "clock_gettime",
        230 => "clock_nanosleep",
        231 => "exit_group",
        232 => "epoll_wait",
        233 => "epoll_ctl",
        257 => "openat",
        262 => "newfstatat",
        263 => "unlinkat",
        281 => "epoll_pwait",
        288 => "accept4",
        291 => "epoll_create1",
        302 => "prlimit64",
        318 => "getrandom",
        332 => "statx",
        434 => "pidfd_open",
        435 => "clone3",
        439 => "faccessat2",
        _ => "syscall_unknown",
    }
}
