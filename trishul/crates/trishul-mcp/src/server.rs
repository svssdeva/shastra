use rmcp::handler::server::router::tool::ToolRouter;
use rmcp::handler::server::wrapper::Parameters;
use rmcp::model::{
    CallToolResult, Content, Implementation, ProtocolVersion, ServerCapabilities, ServerInfo,
};
use rmcp::schemars::JsonSchema;
use rmcp::{ErrorData as McpError, ServerHandler, tool, tool_handler, tool_router};
use serde::Deserialize;

use crate::collectors;
use crate::types::{CollectorOutput, TOOL_RESPONSE_BUDGET_BYTES};

#[derive(Debug, Clone)]
pub struct Trishul {
    // Read by the #[tool_handler] macro; rustc's dead-code pass doesn't see through it.
    #[allow(dead_code)]
    tool_router: ToolRouter<Trishul>,
}

impl Default for Trishul {
    fn default() -> Self {
        Self { tool_router: Self::tool_router() }
    }
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct ProcessTreeArgs {
    /// Root PID for the tree. Defaults to 1 on Linux/macOS (init/launchd) or 0 on Windows.
    #[serde(default = "default_root_pid")]
    pub root_pid: u32,
    /// Hard cap on number of nodes returned. Defaults to 500 (keeps responses ≲5k tokens).
    #[serde(default = "default_max_nodes")]
    pub max_nodes: usize,
    /// If true, only return the summary and omit the `data` payload.
    #[serde(default)]
    pub summary_only: bool,
}

fn default_root_pid() -> u32 {
    #[cfg(target_os = "windows")]
    {
        0
    }
    #[cfg(not(target_os = "windows"))]
    {
        1
    }
}
fn default_max_nodes() -> usize {
    500
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct ProcSnapshotArgs {
    /// Sort key: `"cpu"` or `"rss"`. Defaults to `"rss"`.
    #[serde(default = "default_sort")]
    pub sort_by: String,
    /// Max processes returned. Defaults to 20 (cap for token safety: 100).
    #[serde(default = "default_limit")]
    pub limit: usize,
    /// If true, only return the summary and omit the `data` payload.
    #[serde(default)]
    pub summary_only: bool,
}

fn default_sort() -> String {
    "rss".into()
}
fn default_limit() -> usize {
    20
}

const PROC_SNAPSHOT_HARD_CAP: usize = 100;

#[derive(Debug, Deserialize, JsonSchema)]
pub struct ProcessDetailArgs {
    pub pid: u32,
    /// If true, only return the summary and omit the `data` payload.
    #[serde(default)]
    pub summary_only: bool,
}

#[derive(Debug, Deserialize, JsonSchema, Default)]
pub struct SummaryOnlyArgs {
    /// If true, only return the summary and omit the `data` payload.
    #[serde(default)]
    pub summary_only: bool,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct SyscallTraceArgs {
    /// How long to trace (milliseconds). Defaults to 1000.
    #[serde(default = "default_duration_ms")]
    pub duration_ms: u64,
    /// Top-N syscalls to return per PID, sorted by count. Defaults to 10.
    #[serde(default = "default_top_per_pid")]
    pub top_per_pid: usize,
    /// Filter to a single PID. If omitted, traces every PID seen during the window.
    #[serde(default)]
    pub pid: Option<u32>,
    /// If true, only return the summary and omit the `data` payload.
    #[serde(default)]
    pub summary_only: bool,
}

fn default_duration_ms() -> u64 {
    1000
}
fn default_top_per_pid() -> usize {
    10
}

#[tool_router]
impl Trishul {
    pub fn new() -> Self {
        Self::default()
    }

    #[tool(
        description = "Snapshot of the host: hostname, OS name + version, kernel, arch, distro id, uptime, load average, total/available/used memory, swap, CPU count + brand. Cross-platform (Linux/macOS/Windows)."
    )]
    async fn host_info(
        &self,
        Parameters(args): Parameters<SummaryOnlyArgs>,
    ) -> Result<CallToolResult, McpError> {
        let out = collectors::host::collect_host_info().map_err(map_err)?;
        Ok(finalize(out, args.summary_only))
    }

    #[tool(
        description = "Process tree rooted at a PID (default 1 on Linux/macOS, 0 on Windows). Each node has pid, ppid, name, cmdline, exe, uid/user, status, rss_kb, virt_kb, cpu_pct, threads. Defaults to max_nodes=500 to keep responses token-light. Use `summary_only` if you just want the node count."
    )]
    async fn process_tree(
        &self,
        Parameters(args): Parameters<ProcessTreeArgs>,
    ) -> Result<CallToolResult, McpError> {
        let out = collectors::proc::collect_process_tree(args.root_pid, args.max_nodes)
            .map_err(map_err)?;
        Ok(finalize(out, args.summary_only))
    }

    #[tool(
        description = "Top-N processes sorted by `rss` (default) or `cpu`. limit defaults to 20 and is hard-capped at 100. Use this for 'what's eating my CPU/memory' questions; cheap and bounded."
    )]
    async fn proc_snapshot(
        &self,
        Parameters(args): Parameters<ProcSnapshotArgs>,
    ) -> Result<CallToolResult, McpError> {
        let limit = args.limit.clamp(1, PROC_SNAPSHOT_HARD_CAP);
        let out = collectors::proc::collect_proc_snapshot(&args.sort_by, limit)
            .map_err(map_err)?;
        Ok(finalize(out, args.summary_only))
    }

    #[tool(
        description = "Detailed view of one process: status, exe, cwd, cmdline, environment (when permitted; capped to first 100 vars × 256 bytes each). Cross-platform."
    )]
    async fn process_detail(
        &self,
        Parameters(args): Parameters<ProcessDetailArgs>,
    ) -> Result<CallToolResult, McpError> {
        let out = collectors::proc::collect_process_detail(args.pid).map_err(map_err)?;
        Ok(finalize(out, args.summary_only))
    }

    #[tool(
        description = "TCP and UDP listening sockets with owning PID + process name (resolved cross-platform via sysinfo). Hard-capped at 500 entries."
    )]
    async fn network_listeners(
        &self,
        Parameters(args): Parameters<SummaryOnlyArgs>,
    ) -> Result<CallToolResult, McpError> {
        let out = collectors::net::collect_network_listeners().map_err(map_err)?;
        Ok(finalize(out, args.summary_only))
    }

    #[tool(
        description = "USB devices attached to the host with descriptor-supplied vendor/product strings and (where /usr/share/hwdata/usb.ids is present) USB-IF database names. Cross-platform via the `nusb` pure-Rust crate."
    )]
    async fn usb_devices(
        &self,
        Parameters(args): Parameters<SummaryOnlyArgs>,
    ) -> Result<CallToolResult, McpError> {
        let out = collectors::usb::collect_usb_devices().map_err(map_err)?;
        Ok(finalize(out, args.summary_only))
    }

    #[tool(
        description = "Per-PID syscall trace over a window. Linux uses eBPF (raw_syscalls/sys_enter); macOS uses dtrace (sudo + SIP-aware); Windows uses ETW (admin / SeSystemProfilePrivilege). Duration is clamped to [10, 30000] ms; top_per_pid to [1, 50]."
    )]
    async fn syscall_trace(
        &self,
        Parameters(args): Parameters<SyscallTraceArgs>,
    ) -> Result<CallToolResult, McpError> {
        let dur_ms = args.duration_ms.clamp(10, 30_000);
        let top = args.top_per_pid.clamp(1, 50);
        let out = collectors::syscall_trace::collect_syscall_trace(
            std::time::Duration::from_millis(dur_ms),
            top,
            args.pid,
        )
        .await
        .map_err(map_err)?;
        Ok(finalize(out, args.summary_only))
    }
}

#[tool_handler]
impl ServerHandler for Trishul {
    fn get_info(&self) -> ServerInfo {
        ServerInfo::new(ServerCapabilities::builder().enable_tools().build())
            .with_server_info(Implementation::from_build_env())
            .with_protocol_version(ProtocolVersion::V_2024_11_05)
            .with_instructions(
                "Trishul gives Claude live Linux observability — process tree, network listeners, \
                 USB devices, and host info. Call `host_info` first to orient yourself.",
            )
    }
}

fn finalize(out: CollectorOutput, summary_only: bool) -> CallToolResult {
    let out = out.finalize(summary_only, TOOL_RESPONSE_BUDGET_BYTES);
    // Use Content::json to avoid double-encoding (string-of-JSON inside an MCP
    // text block). Falls back to compact text if rmcp's JSON encoder rejects
    // for any reason — that path stays ~50% smaller than to_string_pretty.
    match Content::json(&out) {
        Ok(c) => CallToolResult::success(vec![c]),
        Err(_) => {
            let json = serde_json::to_string(&out).unwrap_or_else(|_| "{}".into());
            CallToolResult::success(vec![Content::text(json)])
        }
    }
}

fn map_err(e: crate::types::TrishulError) -> McpError {
    McpError::internal_error(e.to_string(), None)
}
