use anyhow::Result;
use aya_build::{Package, Toolchain, build_ebpf};

fn main() -> Result<()> {
    // On non-Linux targets, skip the BPF build — the syscall_trace tool is gated to Linux.
    let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    if target_os != "linux" {
        println!("cargo:warning=skipping BPF build on non-Linux target ({target_os})");
        // Still emit a stub OUT_DIR/trishul-ebpf so include_bytes! doesn't break.
        let out_dir =
            std::path::PathBuf::from(std::env::var("OUT_DIR").expect("OUT_DIR not set"));
        std::fs::write(out_dir.join("trishul-ebpf"), b"")?;
        return Ok(());
    }

    build_ebpf(
        [Package {
            name: "trishul-ebpf",
            root_dir: "../trishul-ebpf",
            no_default_features: false,
            features: &[],
        }],
        Toolchain::Nightly,
    )?;
    Ok(())
}
