// Cross-platform collectors (Linux, macOS, Windows).
pub mod host;
pub mod net;
pub mod proc;

// Linux-only collectors. On other platforms the corresponding MCP tools
// return a structured "unsupported on this OS" error instead of failing
// the build.
#[cfg(target_os = "linux")]
pub mod usb;

#[cfg(target_os = "linux")]
pub mod ebpf;
