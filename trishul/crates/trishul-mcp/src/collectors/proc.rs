use std::collections::HashMap;

use procfs::process::all_processes;
use serde::Serialize;
use serde_json::json;

use crate::types::{CollectorOutput, TrishulError};

#[derive(Debug, Serialize, Clone)]
pub struct ProcessNode {
    pub pid: i32,
    pub ppid: i32,
    pub comm: String,
    pub cmdline: Vec<String>,
    pub exe: Option<String>,
    pub uid: u32,
    pub user: Option<String>,
    pub state: char,
    pub rss_kb: u64,
    pub vsz_kb: u64,
    pub threads: i64,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub children: Vec<ProcessNode>,
}

#[derive(Debug, Serialize)]
struct FlatProcess {
    pid: i32,
    ppid: i32,
    uid: u32,
    user: Option<String>,
    comm: String,
    cmdline: Vec<String>,
    exe: Option<String>,
    state: char,
    rss_kb: u64,
    vsz_kb: u64,
    threads: i64,
    cpu_pct: f64,
}

pub fn collect_process_tree(
    root_pid: i32,
    max_nodes: usize,
) -> Result<CollectorOutput, TrishulError> {
    let (flats, warnings) = read_all_processes();
    let by_pid: HashMap<i32, FlatProcess> = flats.into_iter().map(|p| (p.pid, p)).collect();
    let mut children_of: HashMap<i32, Vec<i32>> = HashMap::new();
    for p in by_pid.values() {
        children_of.entry(p.ppid).or_default().push(p.pid);
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
            n.comm,
            count,
            if truncated.get() { " (truncated)" } else { "" }
        ),
        None => format!("no process found with pid {}", root_pid),
    };
    let data = serde_json::to_value(&tree).unwrap_or(json!(null));
    Ok(CollectorOutput::new(summary, data).with_truncated(truncated.get()).warnings_extend(warnings))
}

pub fn collect_proc_snapshot(
    sort_by: &str,
    limit: usize,
) -> Result<CollectorOutput, TrishulError> {
    let (mut flats, warnings) = read_all_processes();
    match sort_by {
        "rss" => flats.sort_unstable_by_key(|p| std::cmp::Reverse(p.rss_kb)),
        "cpu" | _ => {
            // Best-effort CPU%: this snapshot is single-sample; we don't compute deltas in MVP.
            // Sort by RSS as a useful default until two-sample CPU is wired.
            flats.sort_unstable_by_key(|p| std::cmp::Reverse(p.rss_kb))
        }
    }
    let truncated = flats.len() > limit;
    flats.truncate(limit);
    let summary = format!(
        "top {} processes by {} (total {} processes scanned)",
        flats.len(),
        if sort_by == "cpu" { "rss (cpu sampling deferred to v2)" } else { sort_by },
        flats.len() + if truncated { 1 } else { 0 },
    );
    let data = json!({ "processes": flats });
    Ok(CollectorOutput::new(summary, data).with_truncated(truncated).warnings_extend(warnings))
}

pub fn collect_process_detail(pid: i32) -> Result<CollectorOutput, TrishulError> {
    let proc = procfs::process::Process::new(pid).map_err(|_| {
        TrishulError::BadArgs(format!("pid {} not found", pid))
    })?;
    let stat = proc.stat().ok();
    let status = proc.status().ok().map(status_to_json);
    let cmdline = proc.cmdline().unwrap_or_default();
    let exe = proc.exe().ok().and_then(|p| p.to_str().map(|s| s.to_string()));
    let cwd = proc.cwd().ok().and_then(|p| p.to_str().map(|s| s.to_string()));
    let mut warnings = Vec::new();
    let env = match proc.environ() {
        Ok(map) => Some(
            map.into_iter()
                .map(|(k, v)| {
                    (k.to_string_lossy().into_owned(), v.to_string_lossy().into_owned())
                })
                .collect::<HashMap<_, _>>(),
        ),
        Err(_) => {
            warnings.push(format!("could not read /proc/{}/environ (perms)", pid));
            None
        }
    };

    let comm = stat.as_ref().map(|s| s.comm.clone()).unwrap_or_default();
    let summary = format!("pid {} · {} · cmdline: {}", pid, comm, cmdline.join(" "));
    let data = json!({
        "pid": pid,
        "comm": comm,
        "cmdline": cmdline,
        "exe": exe,
        "cwd": cwd,
        "status": status,
        "env": env,
    });
    Ok(CollectorOutput::new(summary, data).warnings_extend(warnings))
}

fn read_all_processes() -> (Vec<FlatProcess>, Vec<String>) {
    let mut out = Vec::new();
    let mut warnings = Vec::new();
    let page_size_kb = (procfs::page_size() / 1024).max(1);
    let users = passwd_map();
    let iter = match all_processes() {
        Ok(it) => it,
        Err(e) => {
            warnings.push(format!("could not enumerate /proc: {}", e));
            return (out, warnings);
        }
    };
    for proc_res in iter {
        let Ok(p) = proc_res else { continue };
        let Ok(stat) = p.stat() else { continue };
        let pid = p.pid();
        let ppid = stat.ppid;
        let uid = p.uid().unwrap_or(0);
        let user = users.get(&uid).cloned();
        let comm = stat.comm.clone();
        let cmdline = p.cmdline().unwrap_or_default();
        let exe = p.exe().ok().and_then(|p| p.to_str().map(|s| s.to_string()));
        let state = stat.state;
        let rss_kb = (stat.rss as u64).saturating_mul(page_size_kb as u64);
        let vsz_kb = stat.vsize / 1024;
        let threads = stat.num_threads;
        out.push(FlatProcess {
            pid,
            ppid,
            uid,
            user,
            comm,
            cmdline,
            exe,
            state,
            rss_kb,
            vsz_kb,
            threads,
            cpu_pct: 0.0,
        });
    }
    (out, warnings)
}

fn passwd_map() -> HashMap<u32, String> {
    let mut map = HashMap::new();
    let Ok(text) = std::fs::read_to_string("/etc/passwd") else { return map };
    for line in text.lines() {
        let parts: Vec<&str> = line.split(':').collect();
        if parts.len() >= 3
            && let Ok(uid) = parts[2].parse::<u32>()
        {
            map.insert(uid, parts[0].to_string());
        }
    }
    map
}

fn build_subtree(
    pid: i32,
    by_pid: &HashMap<i32, FlatProcess>,
    children_of: &HashMap<i32, Vec<i32>>,
    total: &mut usize,
    max_nodes: usize,
    truncated: &std::cell::Cell<bool>,
) -> Option<ProcessNode> {
    let p = by_pid.get(&pid)?;
    *total += 1;
    let mut node = ProcessNode {
        pid: p.pid,
        ppid: p.ppid,
        comm: p.comm.clone(),
        cmdline: p.cmdline.clone(),
        exe: p.exe.clone(),
        uid: p.uid,
        user: p.user.clone(),
        state: p.state,
        rss_kb: p.rss_kb,
        vsz_kb: p.vsz_kb,
        threads: p.threads,
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

// Small extension to CollectorOutput to accept a vec of warnings ergonomically.
trait WithWarnings {
    fn warnings_extend(self, ws: Vec<String>) -> Self;
}
impl WithWarnings for CollectorOutput {
    fn warnings_extend(mut self, ws: Vec<String>) -> Self {
        self.warnings.extend(ws);
        self
    }
}

fn status_to_json(s: procfs::process::Status) -> serde_json::Value {
    json!({
        "name": s.name,
        "state": s.state,
        "tgid": s.tgid,
        "pid": s.pid,
        "ppid": s.ppid,
        "uid": s.ruid,
        "gid": s.rgid,
        "threads": s.threads,
        "vmpeak_kb": s.vmpeak,
        "vmsize_kb": s.vmsize,
        "vmrss_kb": s.vmrss,
        "vmhwm_kb": s.vmhwm,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn process_tree_finds_init_or_self() {
        let out = collect_process_tree(std::process::id() as i32, 1000).expect("collect");
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
        let pid = std::process::id() as i32;
        let out = collect_process_detail(pid).expect("collect");
        assert_eq!(out.data["pid"].as_i64().unwrap() as i32, pid);
    }
}
