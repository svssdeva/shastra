import { detectCapabilities } from './capabilities.ts';
import type {
  BackendCapabilities,
  InferenceBackend,
  LoadedModel,
  LoadOptions,
  ModelSpec,
  RunOptions,
  TaskKind,
} from './types.ts';
import { InferenceError } from './types.ts';

/**
 * Backend wrapping `@huggingface/transformers` v3. Imported lazily so the bundle stays small
 * until a real pipeline asks for it — the dev server, the echo seam, and the landing page never
 * pay for it.
 *
 * Maps `ModelSpec.task` to the transformers.js pipeline task string. WebGPU is preferred; falls
 * back to WASM if unavailable. Quantization is requested via `dtype` per HF's v3 conventions.
 */
export class TransformersJsBackend implements InferenceBackend {
  readonly id = 'transformers-js' as const;
  readonly label = 'transformers.js';

  private _capabilities: BackendCapabilities | undefined;
  private readonly loaded: LoadedModel[] = [];

  get capabilities(): BackendCapabilities {
    return this._capabilities ?? { webgpu: false, webgl: false, wasm: true };
  }

  async load<I, O>(spec: ModelSpec, opts: LoadOptions = {}): Promise<LoadedModel<I, O>> {
    this._capabilities ??= await detectCapabilities();
    let mod: typeof import('@huggingface/transformers');
    try {
      mod = await import('@huggingface/transformers');
    } catch (err) {
      const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      throw new InferenceError(
        `@huggingface/transformers failed to load — ${detail}. If you just bumped the package, restart 'bun dev'.`,
        err,
      );
    }
    const device = this._capabilities.webgpu ? 'webgpu' : 'wasm';
    const totalBytes = spec.files.reduce((s, f) => s + f.bytes, 0) || 1;
    opts.onProgress?.({ phase: 'fetch', loaded: 0, total: totalBytes, message: 'loading model' });
    const pipelineFn = await mod.pipeline(mapTask(spec.task), spec.id, {
      device,
      dtype: spec.quantization ?? 'q8',
      progress_callback: (info: TransformersProgress) => {
        if (info.status === 'progress') {
          opts.onProgress?.({
            phase: 'fetch',
            loaded: info.loaded ?? 0,
            total: info.total ?? totalBytes,
            message: info.file ?? 'fetching',
          });
        } else if (info.status === 'ready') {
          opts.onProgress?.({
            phase: 'ready',
            loaded: totalBytes,
            total: totalBytes,
            message: 'ready',
          });
        }
      },
    });
    opts.onProgress?.({
      phase: 'warmup',
      loaded: totalBytes,
      total: totalBytes,
      message: 'warming up',
    });
    const model: LoadedModel<I, O> = {
      spec,
      backendId: this.id,
      async run(input: I, runOpts: RunOptions = {}) {
        if (runOpts.signal?.aborted) {
          throw new DOMException('aborted', 'AbortError');
        }
        // transformers.js pipelines take positional args. Accept an array as `[arg, options]`;
        // otherwise pass the value directly.
        const fn = pipelineFn as unknown as (...args: unknown[]) => Promise<unknown>;
        const out = Array.isArray(input) ? await fn(...input) : await fn(input);
        return out as O;
      },
      async dispose() {
        await (pipelineFn as unknown as { dispose?: () => Promise<void> }).dispose?.();
      },
    };
    this.loaded.push(model as LoadedModel);
    opts.onProgress?.({
      phase: 'ready',
      loaded: totalBytes,
      total: totalBytes,
      message: 'ready',
    });
    return model;
  }

  async dispose(): Promise<void> {
    await Promise.all(this.loaded.map((m) => m.dispose()));
    this.loaded.length = 0;
  }
}

interface TransformersProgress {
  status: 'progress' | 'ready' | 'done' | 'initiate' | 'download';
  file?: string;
  loaded?: number;
  total?: number;
}

function mapTask(task: TaskKind): string {
  switch (task) {
    case 'image-to-text':
      return 'image-to-text';
    case 'object-detection':
      return 'object-detection';
    case 'translation':
      return 'translation';
    case 'echo':
      throw new InferenceError('TransformersJsBackend cannot run the echo task');
  }
}
