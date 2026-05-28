use std::collections::HashMap;
use std::fs;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};
use std::path::Path;

use serde::Serialize;
use serde_json::json;

use crate::types::{CollectorOutput, TrishulError};

#[derive(Debug, Serialize)]
pub struct Listener {
    pub proto: &'static str, // "tcp" | "tcp6" | "udp" | "udp6"
    pub local_addr: String,
    pub local_port: u16,
    pub inode: u64,
    pub uid: u32,
    pub pid: Option<i32>,
    pub comm: Option<String>,
}

pub fn collect_network_listeners() -> Result<CollectorOutput, TrishulError> {
    let mut warnings = Vec::new();
    let mut listeners = Vec::new();

    let inode_to_pid = build_inode_to_pid_map(&mut warnings);

    for (proto, path) in &[
        ("tcp", "/proc/net/tcp"),
        ("tcp6", "/proc/net/tcp6"),
        ("udp", "/proc/net/udp"),
        ("udp6", "/proc/net/udp6"),
    ] {
        match fs::read_to_string(path) {
            Ok(text) => {
                let only_listen = proto.starts_with("tcp");
                listeners.extend(parse_net_table(&text, proto, &inode_to_pid, only_listen));
            }
            Err(e) => warnings.push(format!("read {}: {}", path, e)),
        }
    }

    listeners.sort_by_key(|l| (l.proto, l.local_port));

    let summary = format!(
        "{} listening socket(s) ({} resolved to PIDs)",
        listeners.len(),
        listeners.iter().filter(|l| l.pid.is_some()).count(),
    );
    let data = json!({ "listeners": listeners });
    let mut out = CollectorOutput::new(summary, data);
    out.warnings.extend(warnings);
    Ok(out)
}

fn build_inode_to_pid_map(warnings: &mut Vec<String>) -> HashMap<u64, (i32, String)> {
    let mut map = HashMap::new();
    let Ok(entries) = fs::read_dir("/proc") else { return map };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        let Ok(pid) = name.parse::<i32>() else { continue };
        let comm = fs::read_to_string(format!("/proc/{}/comm", pid))
            .ok()
            .map(|s| s.trim().to_string())
            .unwrap_or_default();
        let fd_dir = format!("/proc/{}/fd", pid);
        let Ok(fds) = fs::read_dir(&fd_dir) else { continue };
        for fd in fds.flatten() {
            let target = match fs::read_link(fd.path()) {
                Ok(t) => t,
                Err(_) => continue,
            };
            let target_str = target.to_string_lossy();
            if let Some(rest) = target_str.strip_prefix("socket:[")
                && let Some(num) = rest.strip_suffix(']')
                && let Ok(inode) = num.parse::<u64>()
            {
                map.entry(inode).or_insert_with(|| (pid, comm.clone()));
            }
        }
    }
    if map.is_empty() {
        warnings.push("inode→PID map is empty (may need higher privileges)".into());
    }
    map
}

fn parse_net_table(
    text: &str,
    proto: &'static str,
    inode_map: &HashMap<u64, (i32, String)>,
    only_listen: bool,
) -> Vec<Listener> {
    let mut out = Vec::new();
    // Skip header line.
    for line in text.lines().skip(1) {
        let cols: Vec<&str> = line.split_whitespace().collect();
        if cols.len() < 10 {
            continue;
        }
        // cols[1] = local_address (hex), cols[3] = state, cols[7] = uid, cols[9] = inode
        let local_field = cols[1];
        let state = cols[3];
        if only_listen && state != "0A" {
            // 0A = LISTEN for TCP
            continue;
        }
        let Some((ip, port)) = parse_addr_field(local_field) else { continue };
        let uid: u32 = cols[7].parse().unwrap_or(0);
        let inode: u64 = cols[9].parse().unwrap_or(0);
        let (pid, comm) = match inode_map.get(&inode) {
            Some((p, c)) => (Some(*p), Some(c.clone())),
            None => (None, None),
        };
        out.push(Listener {
            proto,
            local_addr: ip.to_string(),
            local_port: port,
            inode,
            uid,
            pid,
            comm,
        });
    }
    out
}

fn parse_addr_field(s: &str) -> Option<(IpAddr, u16)> {
    let (addr_hex, port_hex) = s.split_once(':')?;
    let port = u16::from_str_radix(port_hex, 16).ok()?;
    match addr_hex.len() {
        8 => {
            let raw = u32::from_str_radix(addr_hex, 16).ok()?;
            // Linux stores little-endian per 4-byte word; bytes are LE.
            let octets = raw.to_le_bytes();
            Some((IpAddr::V4(Ipv4Addr::from(octets)), port))
        }
        32 => {
            // 4 little-endian u32 words.
            let mut bytes = [0u8; 16];
            for i in 0..4 {
                let chunk = &addr_hex[i * 8..(i + 1) * 8];
                let raw = u32::from_str_radix(chunk, 16).ok()?;
                let le = raw.to_le_bytes();
                bytes[i * 4..(i + 1) * 4].copy_from_slice(&le);
            }
            Some((IpAddr::V6(Ipv6Addr::from(bytes)), port))
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_known_tcp_table_row() {
        let sample = "  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode\n   0: 0100007F:1538 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 1234567 1 0000000000000000 100 0 0 10 0";
        let v = parse_net_table(sample, "tcp", &HashMap::new(), true);
        assert_eq!(v.len(), 1);
        assert_eq!(v[0].local_port, 0x1538);
        assert_eq!(v[0].local_addr, "127.0.0.1");
        assert_eq!(v[0].inode, 1234567);
    }

    #[test]
    fn parses_tcp6_row() {
        // ::1 = 0000000000000000 0000000000000000 0000000000000000 0100000000000000 in /proc/net/tcp6
        let sample = "  sl  local_address                         rem_address                        st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode\n   0: 00000000000000000000000001000000:0050 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 9999 1 0000000000000000 100 0 0 10 0";
        let v = parse_net_table(sample, "tcp6", &HashMap::new(), true);
        assert_eq!(v.len(), 1);
        assert_eq!(v[0].local_port, 0x50);
    }
}
