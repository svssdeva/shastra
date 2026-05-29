import type {
  BackendCapabilities,
  InferenceBackend,
  LoadedModel,
  LoadOptions,
  ModelSpec,
  RunOptions,
} from './types.ts';

/**
 * Deterministic backend used in tests and in phase 1's `EchoPipeline` — proves the seam without
 * touching any real ML runtime.
 */
export class MockBackend implements InferenceBackend {
  readonly id = 'mock' as const;
  readonly label = 'Mock (deterministic)';
  readonly capabilities: BackendCapabilities = { webgpu: false, webgl: false, wasm: true };

  async load<I, O>(spec: ModelSpec, opts: LoadOptions = {}): Promise<LoadedModel<I, O>> {
    const total = spec.files.reduce((sum, f) => sum + f.bytes, 0) || 1;
    opts.onProgress?.({ phase: 'fetch', loaded: 0, total, message: 'fetching mock weights' });
    await sleep(50, opts.signal);
    opts.onProgress?.({ phase: 'warmup', loaded: total, total, message: 'warming up' });
    await sleep(50, opts.signal);
    opts.onProgress?.({ phase: 'ready', loaded: total, total, message: 'ready' });
    return new MockLoadedModel<I, O>(spec);
  }

  async dispose(): Promise<void> {}
}

class MockLoadedModel<I, O> implements LoadedModel<I, O> {
  readonly backendId = 'mock' as const;
  constructor(public readonly spec: ModelSpec) {}
  async run(input: I, opts: RunOptions = {}): Promise<O> {
    await sleep(120, opts.signal);
    return { mock: true, echo: input, spec: this.spec.id } as unknown as O;
  }
  async dispose(): Promise<void> {}
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('aborted', 'AbortError'));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new DOMException('aborted', 'AbortError'));
    });
  });
}
