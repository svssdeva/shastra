use std::fs;

use serde::Serialize;
use serde_json::json;

use crate::types::{CollectorOutput, TrishulError};

#[derive(Debug, Serialize)]
pub struct HostInfo {
    pub hostname: String,
    pub kernel_release: String,
    pub kernel_version: String,
    pub arch: String,
    pub distro: Option<String>,
    pub uptime_secs: f64,
    pub load: [f64; 3],
    pub mem_total_kb: u64,
    pub mem_available_kb: u64,
    pub mem_free_kb: u64,
    pub swap_total_kb: u64,
    pub swap_free_kb: u64,
    pub cpu_count: usize,
}

pub fn collect_host_info() -> Result<CollectorOutput, TrishulError> {
    let uname = nix::sys::utsname::uname().map_err(|e| TrishulError::Procfs(e.to_string()))?;
    let hostname = uname.nodename().to_string_lossy().into_owned();
    let kernel_release = uname.release().to_string_lossy().into_owned();
    let kernel_version = uname.version().to_string_lossy().into_owned();
    let arch = uname.machine().to_string_lossy().into_owned();

    let distro = read_os_release_pretty();

    let uptime_secs = fs::read_to_string("/proc/uptime")
        .ok()
        .and_then(|s| s.split_whitespace().next().and_then(|f| f.parse::<f64>().ok()))
        .unwrap_or(0.0);

    let load = read_loadavg();

    let mem = read_meminfo();
    let cpu_count = num_cpus_online();

    let info = HostInfo {
        hostname: hostname.clone(),
        kernel_release: kernel_release.clone(),
        kernel_version,
        arch: arch.clone(),
        distro: distro.clone(),
        uptime_secs,
        load,
        mem_total_kb: mem.mem_total_kb,
        mem_available_kb: mem.mem_available_kb,
        mem_free_kb: mem.mem_free_kb,
        swap_total_kb: mem.swap_total_kb,
        swap_free_kb: mem.swap_free_kb,
        cpu_count,
    };

    let summary = format!(
        "{} · {} · kernel {} · {} CPUs · {:.1} GiB RAM ({:.1} free) · load {:.2}",
        hostname,
        distro.unwrap_or_else(|| "Linux".into()),
        kernel_release,
        cpu_count,
        mem.mem_total_kb as f64 / 1024.0 / 1024.0,
        mem.mem_available_kb as f64 / 1024.0 / 1024.0,
        load[0],
    );

    let data = serde_json::to_value(info)
        .unwrap_or_else(|_| json!({"error":"serialize host_info failed"}));
    Ok(CollectorOutput::new(summary, data))
}

#[derive(Default)]
struct Mem {
    mem_total_kb: u64,
    mem_available_kb: u64,
    mem_free_kb: u64,
    swap_total_kb: u64,
    swap_free_kb: u64,
}

fn read_meminfo() -> Mem {
    let mut m = Mem::default();
    let Ok(text) = fs::read_to_string("/proc/meminfo") else { return m };
    for line in text.lines() {
        let Some((key, rest)) = line.split_once(':') else { continue };
        let val_kb = rest.trim().trim_end_matches(" kB").parse::<u64>().unwrap_or(0);
        match key {
            "MemTotal" => m.mem_total_kb = val_kb,
            "MemAvailable" => m.mem_available_kb = val_kb,
            "MemFree" => m.mem_free_kb = val_kb,
            "SwapTotal" => m.swap_total_kb = val_kb,
            "SwapFree" => m.swap_free_kb = val_kb,
            _ => {}
        }
    }
    m
}

fn read_loadavg() -> [f64; 3] {
    let Ok(text) = fs::read_to_string("/proc/loadavg") else { return [0.0; 3] };
    let parts: Vec<f64> = text.split_whitespace().take(3).filter_map(|s| s.parse().ok()).collect();
    [
        parts.first().copied().unwrap_or(0.0),
        parts.get(1).copied().unwrap_or(0.0),
        parts.get(2).copied().unwrap_or(0.0),
    ]
}

fn read_os_release_pretty() -> Option<String> {
    let text = fs::read_to_string("/etc/os-release").ok()?;
    for line in text.lines() {
        if let Some(rest) = line.strip_prefix("PRETTY_NAME=") {
            return Some(rest.trim_matches('"').to_string());
        }
    }
    None
}

fn num_cpus_online() -> usize {
    nix::unistd::sysconf(nix::unistd::SysconfVar::_NPROCESSORS_ONLN)
        .ok()
        .flatten()
        .map(|n| n as usize)
        .unwrap_or(1)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn collects_something_sane_on_this_host() {
        let out = collect_host_info().expect("collect");
        assert!(!out.summary.is_empty(), "summary should not be empty");
        let v = &out.data;
        assert!(v["cpu_count"].as_u64().unwrap_or(0) >= 1);
        assert!(v["mem_total_kb"].as_u64().unwrap_or(0) > 0);
    }
}
