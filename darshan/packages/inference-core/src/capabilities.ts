import type { BackendCapabilities } from './types.ts';

/**
 * Detect the current environment's inference capabilities. Safe to call in main thread or worker.
 * WebGPU detection is async because `navigator.gpu.requestAdapter()` is async — but the result
 * is cached after the first call.
 */
let cached: BackendCapabilities | undefined;

export async function detectCapabilities(): Promise<BackendCapabilities> {
  if (cached) return cached;
  const wasm = typeof WebAssembly !== 'undefined';
  const webgl = (() => {
    if (typeof document === 'undefined') return false;
    try {
      const canvas = document.createElement('canvas');
      return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
    } catch {
      return false;
    }
  })();
  const webgpu = await (async () => {
    const gpu = (globalThis as { navigator?: { gpu?: { requestAdapter: () => Promise<unknown> } } })
      .navigator?.gpu;
    if (!gpu) return false;
    try {
      const adapter = await gpu.requestAdapter();
      return Boolean(adapter);
    } catch {
      return false;
    }
  })();
  cached = { webgpu, webgl, wasm };
  return cached;
}

export function resetCapabilitiesCacheForTesting(): void {
  cached = undefined;
}
