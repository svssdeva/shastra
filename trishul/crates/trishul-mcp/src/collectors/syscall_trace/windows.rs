//! Windows backend: NT Kernel Logger `SystemCall` events via ferrisetw.
//!
//! Subscribes to the kernel session, lets it run for the requested duration,
//! and aggregates per-(pid, syscall_address) counts. Windows ETW emits a
//! `SysCallEnter` event with the syscall function address rather than a
//! stable syscall number; we keep the address as the `nr` field and resolve
//! a human-readable name only when we have a symbol table for the kernel
//! image (we don't ship one — that lookup is deferred).
//!
//! Requires admin / `SeSystemProfilePrivilege`. Surfaced as a clear error if
//! the trace fails to start with `ERROR_ACCESS_DENIED`.

use std::collections::HashMap as StdMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use ferrisetw::EventRecord;
use ferrisetw::parser::Parser;
use ferrisetw::provider::Provider;
use ferrisetw::provider::kernel_providers::SYSTEM_CALL_PROVIDER;
use ferrisetw::schema_locator::SchemaLocator;
use ferrisetw::trace::KernelTrace;

use super::{PidSummary, SyscallCount};
use crate::types::TrishulError;

type CountsMap = StdMap<(u32, u64), u64>;

pub async fn collect(
    duration: Duration,
    pid_filter: Option<u32>,
) -> Result<Vec<PidSummary>, TrishulError> {
    let counts: Arc<Mutex<CountsMap>> = Arc::new(Mutex::new(StdMap::new()));
    let counts_cb = counts.clone();

    let provider = Provider::kernel(&SYSTEM_CALL_PROVIDER)
        .add_callback(move |record: &EventRecord, schema_locator: &SchemaLocator| {
            let Ok(schema) = schema_locator.event_schema(record) else { return };
            let parser = Parser::create(record, &schema);
            // ProcessID lives on the record, not the parser, on kernel events.
            let pid = record.process_id();
            if let Some(p) = pid_filter
                && pid != p
            {
                return;
            }
            // SysCallEnter exposes `SysCallAddress` as a pointer-sized field.
            let nr: u64 = parser
                .try_parse::<u64>("SysCallAddress")
                .or_else(|_| parser.try_parse::<u32>("SysCallAddress").map(|n| n as u64))
                .unwrap_or(0);
            let mut m = counts_cb.lock().expect("counts mutex poisoned");
            *m.entry((pid, nr)).or_insert(0) += 1;
        })
        .build();

    // start_and_process is blocking; spawn it on a dedicated thread so the
    // tokio runtime keeps spinning while ETW pumps events.
    let trace_handle = tokio::task::spawn_blocking(move || {
        KernelTrace::new().enable(provider).start_and_process()
    });

    // Wait the requested window.
    tokio::time::sleep(duration).await;

    // start_and_process returns the trace; stop it. The returned `KernelTrace`
    // is what we use to call `.stop()`. If the trace failed to start (perm
    // denied), we surface that as RequiresCapability.
    let trace = trace_handle.await.map_err(|e| {
        TrishulError::Procfs(format!("ETW worker join: {e}"))
    })?;
    let trace = trace.map_err(|e| {
        // TraceError doesn't impl Display; use Debug formatting and grep the text.
        let s = format!("{:?}", e);
        let lc = s.to_lowercase();
        if lc.contains("access is denied")
            || lc.contains("erroraccessdenied")
            || lc.contains("error: 5")
            || lc.contains("(5)")
        {
            TrishulError::RequiresCapability(
                "SeSystemProfilePrivilege (run as Administrator) on Windows",
            )
        } else {
            TrishulError::Procfs(format!("ETW start: {s}"))
        }
    })?;
    trace.stop().map_err(|e| TrishulError::Procfs(format!("ETW stop: {:?}", e)))?;

    // Build the per-PID rollup.
    let counts = counts.lock().expect("counts mutex poisoned");
    let mut by_pid: StdMap<u32, PidSummary> = StdMap::new();
    for (&(pid, nr), &count) in counts.iter() {
        let entry = by_pid.entry(pid).or_insert_with(|| PidSummary {
            pid,
            comm: comm_for_pid(pid),
            total: 0,
            top: Vec::new(),
        });
        entry.total = entry.total.saturating_add(count);
        entry.top.push(SyscallCount {
            nr,
            // Windows ETW exposes the syscall function *address* (kernel-image
            // RVA). Resolving to a human name requires the kernel's PDB; we
            // ship without symbol resolution for now.
            name: format!("0x{:x}", nr),
            count,
        });
    }
    Ok(by_pid.into_values().collect())
}

fn comm_for_pid(pid: u32) -> Option<String> {
    use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};
    let mut sys = System::new();
    sys.refresh_processes_specifics(
        ProcessesToUpdate::Some(&[Pid::from_u32(pid)]),
        true,
        ProcessRefreshKind::nothing().with_exe(UpdateKind::OnlyIfNotSet),
    );
    sys.process(Pid::from_u32(pid)).map(|p| p.name().to_string_lossy().into_owned())
}
