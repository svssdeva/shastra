// Cross-platform collectors (Linux, macOS, Windows).
pub mod host;
pub mod net;
pub mod proc;
pub mod usb;

// Linux-only collectors. eBPF does not exist on macOS or Windows; the
// corresponding MCP tools return a structured "unsupported on this OS"
// error on other platforms.
#[cfg(target_os = "linux")]
pub mod ebpf;
