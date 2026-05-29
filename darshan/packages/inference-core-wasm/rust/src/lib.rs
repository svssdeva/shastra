//! Phase 4 seam: Rust compiled to `wasm32-unknown-unknown`, called from TS without wasm-bindgen.
//!
//! The TS side passes inputs by writing into the linear memory at `alloc(len)` and calling
//! `infer(ptr, len, out_ptr_ptr, out_len_ptr)`; the Rust side writes the output bytes into a
//! fresh buffer and stores `(ptr, len)` at the addresses provided. The TS bridge reads them
//! back, copies the bytes out, and calls `free(ptr, len)` to release the buffer.
//!
//! Today's `infer` is the seam-proving "echo" — returns the input prefixed with a `darshan/wasm:`
//! tag plus the version. Phase 5 wires `candle-core` here under the same ABI; the TS bridge does
//! not change.

#[unsafe(no_mangle)]
pub extern "C" fn version() -> u32 {
    // Major.minor.patch packed as 8.8.16.
    (0u32 << 24) | (1u32 << 16) | 0u32
}

#[unsafe(no_mangle)]
pub extern "C" fn alloc(len: usize) -> *mut u8 {
    let mut buf = Vec::<u8>::with_capacity(len);
    let ptr = buf.as_mut_ptr();
    core::mem::forget(buf);
    ptr
}

/// # Safety
/// `ptr` must have been returned by `alloc(len)` and not yet freed.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn free(ptr: *mut u8, len: usize) {
    if ptr.is_null() {
        return;
    }
    unsafe {
        let _ = Vec::from_raw_parts(ptr, len, len);
    }
}

/// Write `(out_ptr, out_len)` of the inference result into the two pointers provided.
///
/// # Safety
/// All four pointers must be valid; `input_len` bytes at `input_ptr` must be readable.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn infer(
    input_ptr: *const u8,
    input_len: usize,
    out_ptr_ptr: *mut *mut u8,
    out_len_ptr: *mut usize,
) {
    let input = unsafe { core::slice::from_raw_parts(input_ptr, input_len) };
    let mut out = Vec::with_capacity(input.len() + 24);
    out.extend_from_slice(b"darshan/wasm:");
    let v = version();
    out.push(((v >> 24) & 0xff) as u8);
    out.push(((v >> 16) & 0xff) as u8);
    out.push(((v >> 8) & 0xff) as u8);
    out.push((v & 0xff) as u8);
    out.push(b':');
    out.extend_from_slice(input);
    let len = out.len();
    let ptr = out.as_mut_ptr();
    core::mem::forget(out);
    unsafe {
        *out_ptr_ptr = ptr;
        *out_len_ptr = len;
    }
}
