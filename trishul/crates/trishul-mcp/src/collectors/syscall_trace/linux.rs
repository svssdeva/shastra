//! Linux backend: aya/eBPF `raw_syscalls/sys_enter` tracepoint.

use std::collections::HashMap as StdMap;
use std::time::Duration;

use aya::Ebpf;
use aya::maps::HashMap as BpfHashMap;
use aya::programs::TracePoint;
use nix::libc;

use super::{PidSummary, SyscallCount};
use crate::types::TrishulError;

const TRISHUL_BPF: &[u8] =
    include_bytes!(concat!(env!("OUT_DIR"), "/trishul-syscall-trace"));

pub async fn collect(
    duration: Duration,
    pid_filter: Option<u32>,
) -> Result<Vec<PidSummary>, TrishulError> {
    if !has_bpf_caps() {
        return Err(TrishulError::RequiresCapability("cap_bpf,cap_perfmon"));
    }

    let mut bpf = Ebpf::load(TRISHUL_BPF).map_err(|e| map_load_err(&e))?;
    let program: &mut TracePoint = bpf
        .program_mut("trishul_sys_enter")
        .ok_or_else(|| TrishulError::Procfs("trishul_sys_enter program not found".into()))?
        .try_into()
        .map_err(|e: aya::programs::ProgramError| {
            TrishulError::Procfs(format!("program type mismatch: {e}"))
        })?;
    program.load().map_err(|e| map_program_err(&e))?;
    program
        .attach("raw_syscalls", "sys_enter")
        .map_err(|e| map_program_err(&e))?;

    tokio::time::sleep(duration).await;

    let counts: BpfHashMap<_, u64, u64> = BpfHashMap::try_from(
        bpf.map("SYSCALL_COUNTS")
            .ok_or_else(|| TrishulError::Procfs("SYSCALL_COUNTS map not found".into()))?,
    )
    .map_err(|e| TrishulError::Procfs(format!("open BPF map: {e}")))?;

    let mut by_pid: StdMap<u32, PidSummary> = StdMap::new();
    for entry in counts.iter() {
        let (key, count) = entry.map_err(|e| TrishulError::Procfs(format!("map iter: {e}")))?;
        let pid = (key >> 32) as u32;
        let nr = (key & 0xffff_ffff) as u32;
        if let Some(p) = pid_filter
            && pid != p
        {
            continue;
        }
        let entry = by_pid.entry(pid).or_insert_with(|| PidSummary {
            pid,
            comm: comm_for_pid(pid),
            total: 0,
            top: Vec::new(),
        });
        entry.total = entry.total.saturating_add(count);
        entry.top.push(SyscallCount {
            nr: nr as u64,
            name: syscall_name_x86_64(nr).to_string(),
            count,
        });
    }
    Ok(by_pid.into_values().collect())
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

/// True if euid is root, or if `CAP_BPF` (39) and `CAP_PERFMON` (38) are both
/// in the effective capability set (read from `/proc/self/status:CapEff`).
fn has_bpf_caps() -> bool {
    // SAFETY: geteuid is signal-safe and has no preconditions.
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
