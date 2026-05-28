//! macOS backend: shell-out to `/usr/sbin/dtrace`.
//!
//! Modern macOS restricts DTrace via System Integrity Protection (SIP). On a
//! stock Apple Silicon Mac with default settings, DTrace can observe
//! unsigned / non-Apple-signed processes but is blocked from system binaries
//! and Apple-signed apps. Running without `sudo` will also fail. We surface
//! both failure modes as a clear error pointing the user at the docs instead
//! of silently returning nothing.
//!
//! No production code shells out elsewhere in Trishul; this module is the one
//! deliberate exception, because no first-class macOS API gives per-PID
//! syscall counts without an Apple-signed entitlement (Endpoint Security
//! framework).

use std::collections::HashMap as StdMap;
use std::process::Stdio;
use std::time::Duration;

use tokio::io::AsyncReadExt;
use tokio::process::Command;

use super::{PidSummary, SyscallCount};
use crate::types::TrishulError;

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub async fn collect(
    duration: Duration,
    pid_filter: Option<u32>,
) -> Result<Vec<PidSummary>, TrishulError> {
    // D script: count syscall entries per (pid, syscall name) and print one
    // line per pair on END. Format: "<pid>\t<syscall_name>\t<count>".
    //
    // PID filter is applied in the predicate to keep the kernel-side buffer
    // small. -p is intentionally not used because we want a system-wide sweep.
    let pid_pred = match pid_filter {
        Some(p) => format!("/pid == {}/", p),
        None => String::new(),
    };
    let script = format!(
        r#"syscall:::entry {pred}{{ @c[pid, probefunc] = count(); }} \
           tick-{ms}ms {{ exit(0); }} \
           END {{ printa("PIDSC\t%d\t%s\t%@d\n", @c); }}"#,
        pred = pid_pred,
        ms = duration.as_millis(),
    );

    let mut child = Command::new("/usr/sbin/dtrace")
        .arg("-q")          // quiet, suppress noise
        .arg("-n").arg(&script)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| TrishulError::MissingDep {
            name: "dtrace",
            hint: match e.kind() {
                std::io::ErrorKind::NotFound => "DTrace not found at /usr/sbin/dtrace — required on macOS",
                _ => "could not spawn dtrace; you may need to invoke trishul-mcp via sudo",
            },
        })?;

    // Read stdout + stderr concurrently; dtrace dies on tick-Nms via exit(0).
    let mut stdout = child.stdout.take().expect("stdout piped");
    let mut stderr = child.stderr.take().expect("stderr piped");
    let stdout_handle = tokio::spawn(async move {
        let mut buf = String::new();
        let _ = stdout.read_to_string(&mut buf).await;
        buf
    });
    let stderr_handle = tokio::spawn(async move {
        let mut buf = String::new();
        let _ = stderr.read_to_string(&mut buf).await;
        buf
    });

    let status = child.wait().await.map_err(|e| {
        TrishulError::Procfs(format!("dtrace wait: {e}"))
    })?;
    let out = stdout_handle.await.unwrap_or_default();
    let err = stderr_handle.await.unwrap_or_default();

    if !status.success() {
        // Distinguish the two common failure modes.
        let lc = err.to_lowercase();
        if lc.contains("system integrity protection")
            || lc.contains("dtrace_dof_init")
            || lc.contains("not privileged")
            || lc.contains("permission denied")
        {
            return Err(TrishulError::RequiresCapability(
                "sudo (and SIP-allowing target); on macOS see README → macOS DTrace setup",
            ));
        }
        return Err(TrishulError::Procfs(format!(
            "dtrace exited non-zero: {} — stderr: {}",
            status.code().unwrap_or(-1),
            err.trim()
        )));
    }

    parse_dtrace_output(&out, pid_filter)
}

fn parse_dtrace_output(
    text: &str,
    pid_filter: Option<u32>,
) -> Result<Vec<PidSummary>, TrishulError> {
    let mut by_pid: StdMap<u32, PidSummary> = StdMap::new();
    for line in text.lines() {
        let Some(rest) = line.strip_prefix("PIDSC\t") else { continue };
        let mut iter = rest.splitn(3, '\t');
        let (Some(pid_s), Some(name), Some(count_s)) = (iter.next(), iter.next(), iter.next())
        else {
            continue;
        };
        let Ok(pid) = pid_s.trim().parse::<u32>() else { continue };
        if let Some(p) = pid_filter
            && pid != p
        {
            continue;
        }
        let Ok(count) = count_s.trim().parse::<u64>() else { continue };
        let entry = by_pid.entry(pid).or_insert_with(|| PidSummary {
            pid,
            comm: comm_for_pid(pid),
            total: 0,
            top: Vec::new(),
        });
        entry.total = entry.total.saturating_add(count);
        entry.top.push(SyscallCount {
            // macOS doesn't expose syscall numbers via DTrace; nr is unused (0).
            nr: 0,
            name: name.trim().to_string(),
            count,
        });
    }
    Ok(by_pid.into_values().collect())
}

/// Read process name via libproc. Cheap; we already depend on it through sysinfo.
fn comm_for_pid(pid: u32) -> Option<String> {
    // sysinfo is already in the dep graph and resolves Process.name() on macOS
    // via libproc. We reuse it here rather than calling libproc directly.
    use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};
    let mut sys = System::new();
    sys.refresh_processes_specifics(
        ProcessesToUpdate::Some(&[Pid::from_u32(pid)]),
        true,
        ProcessRefreshKind::nothing().with_exe(UpdateKind::OnlyIfNotSet),
    );
    sys.process(Pid::from_u32(pid)).map(|p| p.name().to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_dtrace_lines() {
        let text = "\
PIDSC\t100\tread\t42
PIDSC\t100\twrite\t9
PIDSC\t250\topen\t3
not_a_data_line
PIDSC\t250\tread\t12
";
        let v = parse_dtrace_output(text, None).expect("parse");
        let mut pids: Vec<u32> = v.iter().map(|p| p.pid).collect();
        pids.sort();
        assert_eq!(pids, vec![100, 250]);
        let p100 = v.iter().find(|p| p.pid == 100).expect("pid 100");
        assert_eq!(p100.total, 51);
    }

    #[test]
    fn applies_pid_filter() {
        let text = "\
PIDSC\t100\tread\t42
PIDSC\t250\topen\t3
";
        let v = parse_dtrace_output(text, Some(250)).expect("parse");
        assert_eq!(v.len(), 1);
        assert_eq!(v[0].pid, 250);
    }
}
