//! Cross-platform syscall trace.
//!
//! Each OS has a different tracing primitive and a different permission story.
//! This module presents a unified `collect_syscall_trace` to the rest of the
//! crate; the platform module under the hood does the real work.
//!
//! | OS      | Backend                                  | Privileges            |
//! |---------|------------------------------------------|-----------------------|
//! | linux   | aya / eBPF (`raw_syscalls/sys_enter`)    | CAP_BPF + CAP_PERFMON |
//! | macos   | shell-out to `/usr/sbin/dtrace`          | sudo + SIP-aware      |
//! | windows | ferrisetw / NT Kernel Logger SystemCall  | admin (SeSystemProfilePrivilege) |
//!
//! macOS DTrace requires a SIP-friendly configuration. On stock System Integrity
//! Protection settings, DTrace can inspect *unsigned/development* processes but
//! is blocked from observing Apple-signed system binaries. We return a clear
//! error pointing at this if the dtrace invocation fails.

use std::time::Duration;

use serde::Serialize;
use serde_json::json;

use crate::types::{CollectorOutput, TrishulError};

#[cfg(target_os = "linux")]
mod linux;
// macOS module is also compiled-checked on Linux for the parser unit tests
// (we can't cross-compile to macOS without the Apple SDK headers locally).
// At runtime the `collect()` dispatcher only calls it on macos via cfg below.
#[cfg(any(target_os = "macos", all(test, target_os = "linux")))]
mod macos;
#[cfg(target_os = "windows")]
mod windows;

/// Per-PID rollup returned by every platform backend.
#[derive(Debug, Serialize)]
pub struct PidSummary {
    pub pid: u32,
    pub comm: Option<String>,
    pub total: u64,
    pub top: Vec<SyscallCount>,
}

/// One (syscall id, name, count) triple. `name` is best-effort per platform.
#[derive(Debug, Serialize)]
pub struct SyscallCount {
    pub nr: u64,
    pub name: String,
    pub count: u64,
}

/// Sample for `duration` and return per-PID top-N syscalls by count.
///
/// `top_per_pid` is how many distinct syscalls to report per PID.
/// `pid_filter` restricts to one PID if `Some`.
pub async fn collect_syscall_trace(
    duration: Duration,
    top_per_pid: usize,
    pid_filter: Option<u32>,
) -> Result<CollectorOutput, TrishulError> {
    #[cfg(target_os = "linux")]
    {
        let summaries = linux::collect(duration, pid_filter).await?;
        Ok(finalize(summaries, duration, top_per_pid, "ebpf (raw_syscalls/sys_enter)"))
    }
    #[cfg(target_os = "macos")]
    {
        let summaries = macos::collect(duration, pid_filter).await?;
        Ok(finalize(summaries, duration, top_per_pid, "dtrace (syscall:::entry)"))
    }
    #[cfg(target_os = "windows")]
    {
        let summaries = windows::collect(duration, pid_filter).await?;
        Ok(finalize(summaries, duration, top_per_pid, "ETW (NT Kernel Logger SystemCall)"))
    }
    #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
    {
        let _ = (duration, top_per_pid, pid_filter);
        Err(TrishulError::Procfs(
            "syscall_trace is supported only on Linux, macOS, and Windows".into(),
        ))
    }
}

fn finalize(
    mut summaries: Vec<PidSummary>,
    duration: Duration,
    top_per_pid: usize,
    backend: &str,
) -> CollectorOutput {
    for s in summaries.iter_mut() {
        s.top.sort_unstable_by_key(|c| std::cmp::Reverse(c.count));
        s.top.truncate(top_per_pid);
    }
    summaries.sort_unstable_by_key(|s| std::cmp::Reverse(s.total));
    let total_calls: u64 = summaries.iter().map(|s| s.total).sum();
    let pid_count = summaries.len();
    let summary = format!(
        "{} PID(s) traced over {:.1}s — {} total syscalls via {}",
        pid_count,
        duration.as_secs_f64(),
        total_calls,
        backend,
    );
    let data = json!({
        "backend": backend,
        "duration_secs": duration.as_secs_f64(),
        "total_calls": total_calls,
        "pids_traced": pid_count,
        "by_pid": summaries,
    });
    CollectorOutput::new(summary, data)
}
