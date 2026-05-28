use rmcp::handler::server::router::tool::ToolRouter;
use rmcp::handler::server::wrapper::Parameters;
use rmcp::model::{
    CallToolResult, Content, Implementation, ProtocolVersion, ServerCapabilities, ServerInfo,
};
use rmcp::schemars::JsonSchema;
use rmcp::{ErrorData as McpError, ServerHandler, tool, tool_handler, tool_router};
use serde::Deserialize;

use crate::collectors;
use crate::types::CollectorOutput;

#[derive(Debug, Clone)]
pub struct Trishul {
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
    /// Hard cap on number of nodes returned. Defaults to 5000.
    #[serde(default = "default_max_nodes")]
    pub max_nodes: usize,
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
    5000
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct ProcSnapshotArgs {
    /// Sort key: "cpu" or "rss". Defaults to "rss" (cpu sampling is v2).
    #[serde(default = "default_sort")]
    pub sort_by: String,
    /// Max processes returned. Defaults to 30.
    #[serde(default = "default_limit")]
    pub limit: usize,
}

fn default_sort() -> String {
    "rss".into()
}
fn default_limit() -> usize {
    30
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct ProcessDetailArgs {
    pub pid: u32,
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
        description = "Snapshot of the current Linux host: hostname, kernel, distro, uptime, load, memory, CPU count."
    )]
    async fn host_info(&self) -> Result<CallToolResult, McpError> {
        let out = collectors::host::collect_host_info().map_err(map_err)?;
        Ok(into_call_result(out))
    }

    #[tool(
        description = "Process tree rooted at a PID (default 1). Each node has pid, ppid, comm, cmdline, uid, user, state, rss_kb, threads."
    )]
    async fn process_tree(
        &self,
        Parameters(args): Parameters<ProcessTreeArgs>,
    ) -> Result<CallToolResult, McpError> {
        let out =
            collectors::proc::collect_process_tree(args.root_pid, args.max_nodes).map_err(map_err)?;
        Ok(into_call_result(out))
    }

    #[tool(
        description = "Top-N processes by RSS or CPU (CPU sampling is best-effort in v1). Returns a flat list."
    )]
    async fn proc_snapshot(
        &self,
        Parameters(args): Parameters<ProcSnapshotArgs>,
    ) -> Result<CallToolResult, McpError> {
        let out = collectors::proc::collect_proc_snapshot(&args.sort_by, args.limit)
            .map_err(map_err)?;
        Ok(into_call_result(out))
    }

    #[tool(
        description = "Detailed view of one process: status, exe, cwd, cmdline, environment (when permitted)."
    )]
    async fn process_detail(
        &self,
        Parameters(args): Parameters<ProcessDetailArgs>,
    ) -> Result<CallToolResult, McpError> {
        let out = collectors::proc::collect_process_detail(args.pid).map_err(map_err)?;
        Ok(into_call_result(out))
    }

    #[tool(
        description = "TCP and UDP sockets in LISTEN state. Each entry includes local address, port, owning PID + comm when resolvable."
    )]
    async fn network_listeners(&self) -> Result<CallToolResult, McpError> {
        let out = collectors::net::collect_network_listeners().map_err(map_err)?;
        Ok(into_call_result(out))
    }

    #[tool(
        description = "USB devices attached to the host with vendor / product names resolved from usb.ids. Linux only — returns an unsupported error on macOS and Windows (libusb-based cross-platform backend is future work)."
    )]
    async fn usb_devices(&self) -> Result<CallToolResult, McpError> {
        #[cfg(target_os = "linux")]
        {
            let out = collectors::usb::collect_usb_devices().map_err(map_err)?;
            Ok(into_call_result(out))
        }
        #[cfg(not(target_os = "linux"))]
        {
            Err(McpError::internal_error(
                "usb_devices is currently Linux-only (reads /sys/bus/usb). \
                 A libusb-based macOS/Windows backend is future work — see project README.",
                None,
            ))
        }
    }

    #[tool(
        description = "eBPF syscall trace: attach a raw_syscalls/sys_enter tracepoint for `duration_ms` and return per-PID top syscalls by count. Requires CAP_BPF and CAP_PERFMON (or root). Linux only."
    )]
    async fn syscall_trace(
        &self,
        Parameters(args): Parameters<SyscallTraceArgs>,
    ) -> Result<CallToolResult, McpError> {
        #[cfg(target_os = "linux")]
        {
            let out = collectors::ebpf::collect_syscall_trace(
                std::time::Duration::from_millis(args.duration_ms),
                args.top_per_pid,
                args.pid,
            )
            .await
            .map_err(map_err)?;
            Ok(into_call_result(out))
        }
        #[cfg(not(target_os = "linux"))]
        {
            let _ = args;
            Err(McpError::internal_error(
                "syscall_trace is Linux-only (requires eBPF)",
                None,
            ))
        }
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

fn into_call_result(out: CollectorOutput) -> CallToolResult {
    let json = serde_json::to_string_pretty(&out).unwrap_or_else(|_| "{}".into());
    CallToolResult::success(vec![Content::text(json)])
}

fn map_err(e: crate::types::TrishulError) -> McpError {
    McpError::internal_error(e.to_string(), None)
}
