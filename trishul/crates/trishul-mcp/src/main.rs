use anyhow::Result;
use clap::{Parser, Subcommand};
use rmcp::ServiceExt;
use rmcp::transport::stdio;
use tracing_subscriber::EnvFilter;

mod collectors;
mod server;
mod types;

#[derive(Parser, Debug)]
#[command(name = "trishul-mcp", version, about = "MCP server for live Linux observability")]
struct Cli {
    #[command(subcommand)]
    cmd: Option<Cmd>,
}

#[derive(Subcommand, Debug)]
enum Cmd {
    /// Run the MCP server over stdio (default).
    Serve,
    /// Run every collector once and print the result to stdout. Useful for sanity-checking.
    Selftest {
        /// If set, only run the named tool.
        #[arg(long)]
        only: Option<String>,
    },
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")))
        .with_writer(std::io::stderr)
        .with_ansi(false)
        .init();

    let cli = Cli::parse();
    match cli.cmd.unwrap_or(Cmd::Serve) {
        Cmd::Serve => serve().await,
        Cmd::Selftest { only } => selftest(only),
    }
}

async fn serve() -> Result<()> {
    let service = server::Trishul::new().serve(stdio()).await?;
    service.waiting().await?;
    Ok(())
}

fn selftest(only: Option<String>) -> Result<()> {
    let runs: &[(&str, fn() -> Result<()>)] = &[
        ("host_info", run_host_info),
        ("process_tree", run_process_tree),
        ("proc_snapshot", run_proc_snapshot),
        ("process_detail_self", run_process_detail_self),
        ("network_listeners", run_network_listeners),
        #[cfg(target_os = "linux")]
        ("usb_devices", run_usb_devices),
        #[cfg(target_os = "linux")]
        ("syscall_trace", run_syscall_trace),
    ];
    let mut fails = 0;
    for (name, run) in runs {
        if let Some(filter) = &only
            && filter != name
        {
            continue;
        }
        let started = std::time::Instant::now();
        match run() {
            Ok(()) => println!("ok    {name:30} {:?}", started.elapsed()),
            Err(e) => {
                println!("FAIL  {name:30} {:?} — {}", started.elapsed(), e);
                fails += 1;
            }
        }
    }
    if fails > 0 {
        anyhow::bail!("{fails} tool(s) failed selftest");
    }
    Ok(())
}

fn run_host_info() -> Result<()> {
    let out = collectors::host::collect_host_info()?;
    println!("  · {}", out.summary);
    Ok(())
}

fn run_process_tree() -> Result<()> {
    let pid = std::process::id();
    let out = collectors::proc::collect_process_tree(pid, 200)?;
    println!("  · {}", out.summary);
    Ok(())
}

fn run_proc_snapshot() -> Result<()> {
    let out = collectors::proc::collect_proc_snapshot("rss", 10)?;
    println!("  · {}", out.summary);
    Ok(())
}

fn run_process_detail_self() -> Result<()> {
    let pid = std::process::id();
    let out = collectors::proc::collect_process_detail(pid)?;
    println!("  · {}", out.summary);
    Ok(())
}

fn run_network_listeners() -> Result<()> {
    let out = collectors::net::collect_network_listeners()?;
    println!("  · {}", out.summary);
    Ok(())
}

#[cfg(target_os = "linux")]
fn run_usb_devices() -> Result<()> {
    let out = collectors::usb::collect_usb_devices()?;
    println!("  · {}", out.summary);
    Ok(())
}

#[cfg(target_os = "linux")]
fn run_syscall_trace() -> Result<()> {
    let out = tokio::task::block_in_place(|| {
        tokio::runtime::Handle::current().block_on(
            collectors::ebpf::collect_syscall_trace(
                std::time::Duration::from_millis(500),
                5,
                None,
            ),
        )
    });
    match out {
        Ok(o) => {
            println!("  · {}", o.summary);
            Ok(())
        }
        Err(e) => {
            println!("  · (skip) {e}");
            // Don't fail selftest on CAP_BPF missing — that's expected without root.
            if matches!(e, crate::types::TrishulError::RequiresCapability(_)) {
                Ok(())
            } else {
                Err(e.into())
            }
        }
    }
}
