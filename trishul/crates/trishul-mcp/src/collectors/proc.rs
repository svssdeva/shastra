//! Cross-platform process collectors backed by `sysinfo`.
//!
//! Returns the same `CollectorOutput` envelope on Linux, macOS, and Windows.
//! Platform-specific extras (environment vars on macOS via libproc, /proc-only
//! fields on Linux) can be layered on later without changing this API.

use std::collections::HashMap;

use serde::Serialize;
use serde_json::json;
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind, Users};

use crate::types::{CollectorOutput, TrishulError};

#[derive(Debug, Serialize, Clone)]
pub struct ProcessNode {
    pub pid: u32,
    pub ppid: Option<u32>,
    pub name: String,
    pub cmdline: Vec<String>,
    pub exe: Option<String>,
    pub user: Option<String>,
    pub uid: Option<String>,
    pub status: String,
    pub rss_kb: u64,
    pub virt_kb: u64,
    pub cpu_pct: f32,
    pub run_time_secs: u64,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub children: Vec<ProcessNode>,
}

#[derive(Debug, Serialize, Clone)]
struct FlatProcess {
    pid: u32,
    ppid: Option<u32>,
    name: String,
    cmdline: Vec<String>,
    exe: Option<String>,
    user: Option<String>,
    uid: Option<String>,
    status: String,
    rss_kb: u64,
    virt_kb: u64,
    cpu_pct: f32,
    run_time_secs: u64,
}

fn build_system() -> System {
    let mut sys = System::new();
    let kind = ProcessRefreshKind::nothing()
        .with_cmd(UpdateKind::Always)
        .with_exe(UpdateKind::Always)
        .with_memory()
        .with_cpu()
        .with_user(UpdateKind::Always);
    sys.refresh_processes_specifics(ProcessesToUpdate::All, true, kind);
    sys
}

fn snapshot() -> (Vec<FlatProcess>, HashMap<u32, FlatProcess>) {
    let sys = build_system();
    let users = Users::new_with_refreshed_list();
    let resolve_user = |uid: Option<&sysinfo::Uid>| -> Option<String> {
        uid.and_then(|u| users.get_user_by_id(u)).map(|u| u.name().to_string())
    };
    let flat: Vec<FlatProcess> = sys
        .processes()
        .iter()
        .map(|(pid, p)| FlatProcess {
            pid: pid.as_u32(),
            ppid: p.parent().map(|p| p.as_u32()),
            name: p.name().to_string_lossy().into_owned(),
            cmdline: p.cmd().iter().map(|s| s.to_string_lossy().into_owned()).collect(),
            exe: p.exe().and_then(|p| p.to_str().map(|s| s.to_string())),
            user: resolve_user(p.user_id()),
            uid: p.user_id().map(|u| u.to_string()),
            status: format!("{:?}", p.status()),
            rss_kb: p.memory() / 1024,
            virt_kb: p.virtual_memory() / 1024,
            cpu_pct: p.cpu_usage(),
            run_time_secs: p.run_time(),
        })
        .collect();
    let by_pid: HashMap<u32, FlatProcess> = flat.iter().cloned().map(|p| (p.pid, p)).collect();
    (flat, by_pid)
}

pub fn collect_process_tree(
    root_pid: u32,
    max_nodes: usize,
) -> Result<CollectorOutput, TrishulError> {
    let (_, by_pid) = snapshot();
    let mut children_of: HashMap<u32, Vec<u32>> = HashMap::new();
    for p in by_pid.values() {
        if let Some(ppid) = p.ppid {
            children_of.entry(ppid).or_default().push(p.pid);
        }
    }
    for v in children_of.values_mut() {
        v.sort_unstable();
    }

    let mut total = 0usize;
    let truncated = std::cell::Cell::new(false);
    let tree = build_subtree(root_pid, &by_pid, &children_of, &mut total, max_nodes, &truncated);

    let count = total;
    let summary = match &tree {
        Some(n) => format!(
            "process tree rooted at pid {} ({}): {} nodes{}",
            n.pid,
            n.name,
            count,
            if truncated.get() { " (truncated)" } else { "" }
        ),
        None => format!("no process found with pid {}", root_pid),
    };
    let data = serde_json::to_value(&tree).unwrap_or(json!(null));
    Ok(CollectorOutput::new(summary, data).with_truncated(truncated.get()))
}

pub fn collect_proc_snapshot(sort_by: &str, limit: usize) -> Result<CollectorOutput, TrishulError> {
    let (mut flats, _) = snapshot();
    match sort_by {
        "cpu" => flats.sort_by(|a, b| {
            b.cpu_pct.partial_cmp(&a.cpu_pct).unwrap_or(std::cmp::Ordering::Equal)
        }),
        _ => flats.sort_unstable_by_key(|p| std::cmp::Reverse(p.rss_kb)),
    }
    let total_seen = flats.len();
    let truncated = total_seen > limit;
    flats.truncate(limit);
    let summary = format!(
        "top {} processes by {} (total {} processes scanned)",
        flats.len(),
        if sort_by == "cpu" { "cpu_pct" } else { "rss" },
        total_seen,
    );
    let data = json!({ "processes": flats });
    Ok(CollectorOutput::new(summary, data).with_truncated(truncated))
}

pub fn collect_process_detail(pid: u32) -> Result<CollectorOutput, TrishulError> {
    let sys = build_system();
    let p = sys
        .process(Pid::from_u32(pid))
        .ok_or_else(|| TrishulError::BadArgs(format!("pid {} not found", pid)))?;
    let users = Users::new_with_refreshed_list();
    let user = p.user_id().and_then(|u| users.get_user_by_id(u)).map(|u| u.name().to_string());

    // Environment retrieval varies by platform: Linux returns via /proc/<pid>/environ
    // when permitted, macOS uses libproc (sysinfo handles both).
    //
    // Bounded to keep responses LLM-friendly:
    //   - max 100 vars
    //   - max 256 bytes per value (longer values get truncated with a marker)
    const MAX_ENV_VARS: usize = 100;
    const MAX_VALUE_BYTES: usize = 256;
    let mut warnings = Vec::new();
    let env: Option<HashMap<String, String>> = {
        let env_pairs = p.environ();
        if env_pairs.is_empty() {
            warnings.push(format!("could not read environment for pid {} (perms or empty)", pid));
            None
        } else {
            let total = env_pairs.len();
            let mut map = HashMap::with_capacity(env_pairs.len().min(MAX_ENV_VARS));
            for entry in env_pairs.iter().take(MAX_ENV_VARS) {
                let s = entry.to_string_lossy().into_owned();
                if let Some((k, v)) = s.split_once('=') {
                    let v_out = if v.len() > MAX_VALUE_BYTES {
                        format!("{}…({} bytes total)", &v[..MAX_VALUE_BYTES], v.len())
                    } else {
                        v.to_string()
                    };
                    map.insert(k.to_string(), v_out);
                }
            }
            if total > MAX_ENV_VARS {
                warnings.push(format!(
                    "environment truncated to first {MAX_ENV_VARS} of {total} variables"
                ));
            }
            Some(map)
        }
    };

    let cmdline: Vec<String> =
        p.cmd().iter().map(|s| s.to_string_lossy().into_owned()).collect();
    let name = p.name().to_string_lossy().into_owned();
    let summary = format!("pid {} · {} · cmdline: {}", pid, name, cmdline.join(" "));
    let data = json!({
        "pid": pid,
        "ppid": p.parent().map(|p| p.as_u32()),
        "name": name,
        "cmdline": cmdline,
        "exe": p.exe().and_then(|p| p.to_str().map(|s| s.to_string())),
        "cwd": p.cwd().and_then(|p| p.to_str().map(|s| s.to_string())),
        "status": format!("{:?}", p.status()),
        "rss_kb": p.memory() / 1024,
        "virt_kb": p.virtual_memory() / 1024,
        "cpu_pct": p.cpu_usage(),
        "run_time_secs": p.run_time(),
        "user": user,
        "uid": p.user_id().map(|u| u.to_string()),
        "env": env,
    });
    let mut out = CollectorOutput::new(summary, data);
    out.warnings.extend(warnings);
    Ok(out)
}

fn build_subtree(
    pid: u32,
    by_pid: &HashMap<u32, FlatProcess>,
    children_of: &HashMap<u32, Vec<u32>>,
    total: &mut usize,
    max_nodes: usize,
    truncated: &std::cell::Cell<bool>,
) -> Option<ProcessNode> {
    let p = by_pid.get(&pid)?;
    *total += 1;
    let mut node = ProcessNode {
        pid: p.pid,
        ppid: p.ppid,
        name: p.name.clone(),
        cmdline: p.cmdline.clone(),
        exe: p.exe.clone(),
        user: p.user.clone(),
        uid: p.uid.clone(),
        status: p.status.clone(),
        rss_kb: p.rss_kb,
        virt_kb: p.virt_kb,
        cpu_pct: p.cpu_pct,
        run_time_secs: p.run_time_secs,
        children: Vec::new(),
    };
    if *total >= max_nodes {
        truncated.set(true);
        return Some(node);
    }
    if let Some(children) = children_of.get(&pid) {
        for c in children {
            if *total >= max_nodes {
                truncated.set(true);
                break;
            }
            if let Some(child) = build_subtree(*c, by_pid, children_of, total, max_nodes, truncated)
            {
                node.children.push(child);
            }
        }
    }
    Some(node)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn process_tree_finds_self() {
        let pid = std::process::id();
        let out = collect_process_tree(pid, 1000).expect("collect");
        assert!(!out.summary.is_empty());
    }

    #[test]
    fn snapshot_returns_some_processes() {
        let out = collect_proc_snapshot("rss", 10).expect("collect");
        let arr = out.data["processes"].as_array().expect("array");
        assert!(!arr.is_empty());
    }

    #[test]
    fn process_detail_for_self() {
        let pid = std::process::id();
        let out = collect_process_detail(pid).expect("collect");
        assert_eq!(out.data["pid"].as_u64().unwrap() as u32, pid);
    }
}
