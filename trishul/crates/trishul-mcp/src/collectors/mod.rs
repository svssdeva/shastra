// Cross-platform collectors (Linux, macOS, Windows).
pub mod host;
pub mod net;
pub mod proc;
pub mod usb;

// Cross-platform syscall trace via aya/eBPF (Linux), dtrace shell-out (macOS),
// ferrisetw/ETW (Windows).
#[cfg(any(target_os = "linux", target_os = "macos", target_os = "windows"))]
pub mod syscall_trace;
