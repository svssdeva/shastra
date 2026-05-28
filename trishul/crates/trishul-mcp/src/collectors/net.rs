//! Cross-platform network listener collector.
//!
//! Uses `netstat2`, which wraps `/proc/net` on Linux, `libproc` on macOS,
//! and `GetExtendedTcpTable`/`GetExtendedUdpTable` on Windows. PID
//! attribution is provided where the platform supports it.

use netstat2::{
    AddressFamilyFlags, ProtocolFlags, ProtocolSocketInfo, TcpState, get_sockets_info,
};
use serde::Serialize;
use serde_json::json;
use sysinfo::{Pid, System};

use crate::types::{CollectorOutput, TrishulError};

#[derive(Debug, Serialize)]
pub struct Listener {
    pub proto: &'static str,
    pub local_addr: String,
    pub local_port: u16,
    pub pid: Option<u32>,
    pub comm: Option<String>,
}

pub fn collect_network_listeners() -> Result<CollectorOutput, TrishulError> {
    let af = AddressFamilyFlags::IPV4 | AddressFamilyFlags::IPV6;
    let proto = ProtocolFlags::TCP | ProtocolFlags::UDP;
    let infos = get_sockets_info(af, proto)
        .map_err(|e| TrishulError::Procfs(format!("netstat2: {e}")))?;

    // Resolve PIDs → process names via sysinfo (cross-platform).
    let mut sys = System::new();
    sys.refresh_processes(sysinfo::ProcessesToUpdate::All, true);
    let comm_for = |pid: u32| -> Option<String> {
        sys.process(Pid::from_u32(pid))
            .map(|p| p.name().to_string_lossy().into_owned())
    };

    const MAX_LISTENERS: usize = 500;

    let mut listeners = Vec::new();
    for info in infos {
        let pid = info.associated_pids.first().copied();
        match info.protocol_socket_info {
            ProtocolSocketInfo::Tcp(t) => {
                if t.state != TcpState::Listen {
                    continue;
                }
                let proto = if t.local_addr.is_ipv6() { "tcp6" } else { "tcp" };
                listeners.push(Listener {
                    proto,
                    local_addr: t.local_addr.to_string(),
                    local_port: t.local_port,
                    pid,
                    comm: pid.and_then(comm_for),
                });
            }
            ProtocolSocketInfo::Udp(u) => {
                let proto = if u.local_addr.is_ipv6() { "udp6" } else { "udp" };
                listeners.push(Listener {
                    proto,
                    local_addr: u.local_addr.to_string(),
                    local_port: u.local_port,
                    pid,
                    comm: pid.and_then(comm_for),
                });
            }
        }
    }
    listeners.sort_by_key(|l| (l.proto, l.local_port));
    let total = listeners.len();
    let truncated = total > MAX_LISTENERS;
    listeners.truncate(MAX_LISTENERS);

    let summary = format!(
        "{} listening socket(s) ({} resolved to PIDs){}",
        total,
        listeners.iter().filter(|l| l.pid.is_some()).count(),
        if truncated {
            format!(", returning first {MAX_LISTENERS}")
        } else {
            String::new()
        },
    );
    let data = json!({ "listeners": listeners });
    Ok(CollectorOutput::new(summary, data).with_truncated(truncated))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn collects_listeners_without_panic() {
        // The actual count varies per host; just assert the call works and shape is sane.
        let out = collect_network_listeners().expect("collect");
        assert!(out.data["listeners"].is_array());
    }
}
