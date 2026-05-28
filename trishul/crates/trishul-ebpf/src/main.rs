#![no_std]
#![no_main]

use aya_ebpf::{
    helpers::bpf_get_current_pid_tgid,
    macros::{map, tracepoint},
    maps::HashMap,
    programs::TracePointContext,
};

// One global HashMap keyed by `(tgid << 32) | (syscall_id & 0xffff_ffff)`
// → count of sys_enter events. 4096 entries is enough for ~100 PIDs × top ~40 syscalls.
#[map]
static SYSCALL_COUNTS: HashMap<u64, u64> = HashMap::with_max_entries(4096, 0);

// raw_syscalls/sys_enter has args: { common_*, long id, unsigned long args[6] }.
// Offset 16 is the syscall id. (Layout is stable; verified via
// /sys/kernel/debug/tracing/events/raw_syscalls/sys_enter/format.)
#[tracepoint(category = "raw_syscalls", name = "sys_enter")]
pub fn trishul_sys_enter(ctx: TracePointContext) -> u32 {
    match try_sys_enter(ctx) {
        Ok(v) => v,
        Err(_) => 0,
    }
}

#[inline(always)]
fn try_sys_enter(ctx: TracePointContext) -> Result<u32, i64> {
    let syscall_id: i64 = unsafe { ctx.read_at(16)? };
    if syscall_id < 0 {
        return Ok(0);
    }
    let tgid = (bpf_get_current_pid_tgid() >> 32) as u32;
    if tgid == 0 {
        return Ok(0);
    }
    let key = ((tgid as u64) << 32) | (syscall_id as u64 & 0xffff_ffff);

    // Increment count for (tgid, syscall_id).
    // Safety: HashMap::get/insert in aya-ebpf are bounds-checked and verifier-friendly.
    unsafe {
        if let Some(count) = SYSCALL_COUNTS.get(&key) {
            let new = count.saturating_add(1);
            let _ = SYSCALL_COUNTS.insert(&key, &new, 0);
        } else {
            let _ = SYSCALL_COUNTS.insert(&key, &1u64, 0);
        }
    }
    Ok(0)
}

#[panic_handler]
fn panic(_info: &core::panic::PanicInfo) -> ! {
    loop {}
}
