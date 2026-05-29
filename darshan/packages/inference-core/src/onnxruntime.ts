import { detectCapabilities } from './capabilities.ts';
import {
  type BackendCapabilities,
  type InferenceBackend,
  InferenceError,
  type LoadedModel,
  type LoadOptions,
  type ModelSpec,
  type RunOptions,
} from './types.ts';

/**
 * Backend wrapping `onnxruntime-web`. Used by `pipeline-dashcam` for YOLO inference; the
 * transformers.js wrapper would also use ORT under the hood but adds a tokenizer / processor
 * pipeline that the dashcam path doesn't need.
 *
 * Lazy imports `onnxruntime-web` on first `load()` so the dev server / echo seam don't pay the
 * ~22 MB wasm cost. Caller passes pre-tensorized inputs as `{ [inputName]: Float32Array }`.
 */

interface OrtTensor {
  data: Float32Array | Int32Array | BigInt64Array;
  dims: readonly number[];
}

interface OrtModule {
  InferenceSession: {
    create(uri: string, opts: Record<string, unknown>): Promise<OrtSession>;
  };
  Tensor: new (
    type: string,
    data: Float32Array | Int32Array | BigInt64Array,
    dims: number[],
  ) => OrtTensor;
  env: {
    wasm: { wasmPaths?: string | Record<string, string>; numThreads?: number; simd?: boolean };
    executionProviders?: string[];
  };
}

interface OrtSession {
  run(feeds: Record<string, OrtTensor>): Promise<Record<string, OrtTensor>>;
  release?(): Promise<void>;
}

let cachedModule: OrtModule | undefined;
let envConfigured = false;

async function loadOrt(): Promise<OrtModule> {
  if (cachedModule) return cachedModule;
  try {
    cachedModule = (await import('onnxruntime-web')) as unknown as OrtModule;
  } catch (err) {
    throw new InferenceError('onnxruntime-web is not installed in this build', err);
  }
  if (!envConfigured) {
    // Skip the multi-threaded ORT build — it needs SharedArrayBuffer, which requires
    // COOP+COEP cross-origin-isolation headers we don't ship from the Astro dev server.
    // ORT auto-locates its sibling .mjs/.wasm via `import.meta.url`; that works because
    // `optimizeDeps.exclude` (see astro.config.mjs) keeps ORT in its native node_modules
    // layout instead of pre-bundling it.
    cachedModule.env.wasm.numThreads = 1;
    envConfigured = true;
  }
  return cachedModule;
}

export interface OnnxRunInput {
  feeds: Record<string, OrtTensor | { data: Float32Array; dims: number[] }>;
}

export interface OnnxRunOutput {
  outputs: Record<string, OrtTensor>;
}

export class OnnxRuntimeWebBackend implements InferenceBackend {
  readonly id = 'onnxruntime-web' as const;
  readonly label = 'ONNX Runtime Web';
  private _capabilities: BackendCapabilities | undefined;

  get capabilities(): BackendCapabilities {
    return this._capabilities ?? { webgpu: false, webgl: false, wasm: true };
  }

  async load<I, O>(spec: ModelSpec, opts: LoadOptions = {}): Promise<LoadedModel<I, O>> {
    this._capabilities ??= await detectCapabilities();
    const ort = await loadOrt();
    const file = spec.files[0];
    if (!file) throw new InferenceError(`ModelSpec ${spec.id} has no files`);
    const url = file.path.startsWith('http')
      ? file.path
      : `https://huggingface.co/${spec.id}/resolve/main/${file.path}`;
    const totalBytes = file.bytes;
    opts.onProgress?.({ phase: 'fetch', loaded: 0, total: totalBytes, message: url });
    const executionProviders = this._capabilities.webgpu ? ['webgpu', 'wasm'] : ['wasm'];
    const session = await ort.InferenceSession.create(url, {
      executionProviders,
      graphOptimizationLevel: 'all',
    });
    opts.onProgress?.({
      phase: 'ready',
      loaded: totalBytes,
      total: totalBytes,
      message: 'ready',
    });
    const model: LoadedModel<I, O> = {
      spec,
      backendId: this.id,
      async run(input: I, runOpts: RunOptions = {}) {
        if (runOpts.signal?.aborted) throw new DOMException('aborted', 'AbortError');
        const { feeds } = input as unknown as OnnxRunInput;
        const tensors: Record<string, OrtTensor> = {};
        for (const [k, v] of Object.entries(feeds)) {
          tensors[k] =
            'dims' in v && v.data instanceof Float32Array && !('type' in v)
              ? new ort.Tensor('float32', v.data, v.dims as number[])
              : (v as OrtTensor);
        }
        const out = await session.run(tensors);
        return { outputs: out } as unknown as O;
      },
      async dispose() {
        await session.release?.();
      },
    };
    return model;
  }

  async dispose(): Promise<void> {}
}
