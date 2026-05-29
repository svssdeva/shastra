/**
 * Lazy loader for the Rust/WASM inference module. Fetches the `.wasm` artifact, instantiates it
 * with no imports (the Rust module is self-contained — no JS glue, no wasm-bindgen), and exposes
 * typed wrappers around `alloc`, `free`, `infer`, `version`.
 */

interface WasmExports {
  memory: WebAssembly.Memory;
  version(): number;
  alloc(len: number): number;
  free(ptr: number, len: number): void;
  infer(inputPtr: number, inputLen: number, outPtrPtr: number, outLenPtr: number): void;
}

export interface WasmModule {
  version: { major: number; minor: number; patch: number };
  infer(input: Uint8Array): Uint8Array;
  dispose(): void;
}

const DEFAULT_PATH = '/wasm/darshan-inference-core.wasm';

let cachedPromise: Promise<WasmModule> | undefined;

export async function loadWasmModule(path: string = DEFAULT_PATH): Promise<WasmModule> {
  if (cachedPromise) return cachedPromise;
  cachedPromise = (async () => {
    let response: Response;
    try {
      response = await fetch(path);
    } catch (err) {
      throw new Error(`darshan/wasm: fetch failed for ${path}: ${String(err)}`);
    }
    if (!response.ok) {
      throw new Error(
        `darshan/wasm: ${path} returned ${response.status} — run 'bun run build:wasm' first`,
      );
    }
    const { instance } = await WebAssembly.instantiateStreaming(response, {});
    const exports = instance.exports as unknown as WasmExports;
    const versionRaw = exports.version();
    const major = (versionRaw >>> 24) & 0xff;
    const minor = (versionRaw >>> 16) & 0xff;
    const patch = versionRaw & 0xffff;
    let disposed = false;
    return {
      version: { major, minor, patch },
      infer(input: Uint8Array): Uint8Array {
        if (disposed) throw new Error('darshan/wasm: module disposed');
        // Any WASM call that allocates may grow `memory.buffer` and detach existing typed-array
        // views. Re-read `memory.buffer` after every call before touching memory.
        const ptr = exports.alloc(input.length);
        new Uint8Array(exports.memory.buffer).set(input, ptr);

        const meta = exports.alloc(8);
        exports.infer(ptr, input.length, meta, meta + 4);

        // `infer` allocated internally — memory may have grown. Refresh the DataView now.
        const metaView = new DataView(exports.memory.buffer, meta, 8);
        const outPtr = metaView.getUint32(0, true);
        const outLen = metaView.getUint32(4, true);
        const out = new Uint8Array(exports.memory.buffer, outPtr, outLen).slice();

        exports.free(outPtr, outLen);
        exports.free(meta, 8);
        exports.free(ptr, input.length);
        return out;
      },
      dispose() {
        disposed = true;
        // The module itself has no resources to release; GC reclaims the memory buffer once the
        // last reference is dropped. Reset the cached promise so a fresh load reloads.
        cachedPromise = undefined;
      },
    };
  })();
  return cachedPromise;
}

export function resetWasmCacheForTesting(): void {
  cachedPromise = undefined;
}
