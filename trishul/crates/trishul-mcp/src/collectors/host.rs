use serde::Serialize;
use serde_json::json;
use sysinfo::System;

use crate::types::{CollectorOutput, TrishulError};

#[derive(Debug, Serialize)]
pub struct HostInfo {
    pub os_name: String,
    pub os_version: String,
    pub kernel_version: String,
    pub hostname: String,
    pub arch: String,
    pub distribution_id: String,
    pub uptime_secs: u64,
    pub load: [f64; 3],
    pub mem_total_kb: u64,
    pub mem_available_kb: u64,
    pub mem_used_kb: u64,
    pub swap_total_kb: u64,
    pub swap_used_kb: u64,
    pub cpu_count: usize,
    pub cpu_brand: String,
}

pub fn collect_host_info() -> Result<CollectorOutput, TrishulError> {
    let mut sys = System::new_all();
    sys.refresh_memory();
    sys.refresh_cpu_all();

    let cpu_count = sys.cpus().len();
    let cpu_brand = sys.cpus().first().map(|c| c.brand().to_string()).unwrap_or_default();

    let load_avg = System::load_average();
    let load = [load_avg.one, load_avg.five, load_avg.fifteen];

    let info = HostInfo {
        os_name: System::name().unwrap_or_else(|| std::env::consts::OS.to_string()),
        os_version: System::os_version().unwrap_or_default(),
        kernel_version: System::kernel_version().unwrap_or_default(),
        hostname: System::host_name().unwrap_or_default(),
        arch: std::env::consts::ARCH.to_string(),
        distribution_id: System::distribution_id(),
        uptime_secs: System::uptime(),
        load,
        mem_total_kb: sys.total_memory() / 1024,
        mem_available_kb: sys.available_memory() / 1024,
        mem_used_kb: sys.used_memory() / 1024,
        swap_total_kb: sys.total_swap() / 1024,
        swap_used_kb: sys.used_swap() / 1024,
        cpu_count,
        cpu_brand,
    };

    let summary = format!(
        "{} · {} {} · {} CPUs ({}) · {:.1} GiB RAM ({:.1} avail) · load {:.2}",
        info.hostname,
        info.os_name,
        info.os_version,
        info.cpu_count,
        if info.cpu_brand.is_empty() { "unknown".into() } else { info.cpu_brand.clone() },
        info.mem_total_kb as f64 / 1024.0 / 1024.0,
        info.mem_available_kb as f64 / 1024.0 / 1024.0,
        info.load[0],
    );

    let data = serde_json::to_value(&info)
        .unwrap_or_else(|_| json!({"error":"serialize host_info failed"}));
    Ok(CollectorOutput::new(summary, data))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn collects_something_sane_on_this_host() {
        let out = collect_host_info().expect("collect");
        assert!(!out.summary.is_empty());
        let v = &out.data;
        assert!(v["cpu_count"].as_u64().unwrap_or(0) >= 1);
        assert!(v["mem_total_kb"].as_u64().unwrap_or(0) > 0);
    }
}
