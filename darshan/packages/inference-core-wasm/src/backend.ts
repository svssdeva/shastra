import {
  type BackendCapabilities,
  type InferenceBackend,
  InferenceError,
  type LoadedModel,
  type LoadOptions,
  type ModelSpec,
  type RunOptions,
} from '@darshan/inference-core';
import { loadWasmModule, type WasmModule } from './wasm-loader.ts';

/**
 * Phase 4 backend: Rust compiled to `wasm32-unknown-unknown`, loaded as a raw WebAssembly module
 * (no wasm-bindgen JS glue). Implements the same `InferenceBackend` interface as the JS-side
 * backends — the UI sees no difference. Today the Rust side returns a tagged echo of the input
 * (proves the seam); phase 5 swaps the Rust crate's `infer()` body for a candle-core call. The
 * TypeScript bridge does not change.
 */
export class WasmCandleBackend implements InferenceBackend {
  readonly id = 'wasm-candle' as const;
  readonly label = 'Candle (WASM)';

  private module?: WasmModule;
  private readonly _capabilities: BackendCapabilities = {
    webgpu: false,
    webgl: false,
    wasm: typeof WebAssembly !== 'undefined',
  };

  get capabilities(): BackendCapabilities {
    return this._capabilities;
  }

  async load<I, O>(spec: ModelSpec, opts: LoadOptions = {}): Promise<LoadedModel<I, O>> {
    if (!this._capabilities.wasm) {
      throw new InferenceError('WebAssembly is not available in this environment');
    }
    opts.onProgress?.({
      phase: 'fetch',
      loaded: 0,
      total: 1,
      message: 'loading darshan/wasm module',
    });
    this.module ??= await loadWasmModule();
    opts.onProgress?.({
      phase: 'warmup',
      loaded: 1,
      total: 1,
      message: `module v${this.module.version.major}.${this.module.version.minor}.${this.module.version.patch}`,
    });
    opts.onProgress?.({ phase: 'ready', loaded: 1, total: 1, message: 'ready' });
    const moduleRef = this.module;
    const model: LoadedModel<I, O> = {
      spec,
      backendId: this.id,
      async run(input: I, runOpts: RunOptions = {}): Promise<O> {
        if (runOpts.signal?.aborted) throw new DOMException('aborted', 'AbortError');
        const bytes = await coerceToBytes(input);
        const out = moduleRef.infer(bytes);
        return { bytes: out, text: new TextDecoder().decode(out) } as unknown as O;
      },
      async dispose() {},
    };
    return model;
  }

  async dispose(): Promise<void> {
    this.module?.dispose();
    this.module = undefined;
  }
}

async function coerceToBytes(input: unknown): Promise<Uint8Array> {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (input instanceof Blob) return new Uint8Array(await input.arrayBuffer());
  if (typeof input === 'string') return new TextEncoder().encode(input);
  if (input && typeof input === 'object' && 'file' in input && input.file instanceof File) {
    // Read up to 64 KiB so a huge drop doesn't OOM the WASM linear memory (echo is metadata-only).
    const file = input.file;
    const slice = file.slice(0, 64 * 1024);
    return new Uint8Array(await slice.arrayBuffer());
  }
  return new TextEncoder().encode(JSON.stringify(input));
}

// Re-export for tests that want to check the error path on truly invalid inputs.
export { InferenceError };
