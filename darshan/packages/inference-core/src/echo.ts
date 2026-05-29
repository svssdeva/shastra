import type {
  InferenceBackend,
  LoadedModel,
  ModelSpec,
  Pipeline,
  PipelineProgress,
} from './types.ts';

export interface EchoInput {
  file: File;
}

export interface EchoOutput {
  filename: string;
  mime: string;
  bytes: number;
  digestPrefix: string;
  message: string;
}

const ECHO_SPEC: ModelSpec = {
  id: 'darshan/echo-v0',
  task: 'echo',
  files: [{ path: 'mock://echo', bytes: 1 }],
};

/**
 * The seam-proving pipeline. Wraps any `InferenceBackend` and returns a deterministic summary of
 * the dropped file. If you can drop a file and see a result render, the worker offload, backend
 * load, and pipeline lifecycle are all wired correctly.
 */
export class EchoPipeline implements Pipeline<EchoInput, EchoOutput> {
  readonly id = 'echo' as const;
  readonly label = 'Echo (seam test)';
  readonly inputKind = 'any' as const;

  private model: LoadedModel<EchoInput, unknown> | undefined;

  async load(backend: InferenceBackend, onProgress?: (p: PipelineProgress) => void): Promise<void> {
    onProgress?.({
      phase: 'loading',
      loaded: 0,
      total: ECHO_SPEC.files[0]?.bytes ?? 1,
      message: `loading echo on ${backend.label}`,
    });
    this.model = await backend.load<EchoInput, unknown>(ECHO_SPEC, {
      onProgress: (p) =>
        onProgress?.({
          phase: 'loading',
          loaded: p.loaded,
          total: p.total,
          message: p.message ?? p.phase,
        }),
    });
    onProgress?.({ phase: 'idle' });
  }

  async *process(
    input: EchoInput,
    onProgress?: (p: PipelineProgress) => void,
  ): AsyncIterable<EchoOutput> {
    if (!this.model) throw new Error('EchoPipeline: call load() before process()');
    onProgress?.({ phase: 'running', loaded: 0, total: 1, message: 'reading file' });
    const buf = await input.file.arrayBuffer();
    const digest = await sha256Hex(buf);
    onProgress?.({ phase: 'running', loaded: 1, total: 1, message: 'echoing' });
    await this.model.run(input);
    const output: EchoOutput = {
      filename: input.file.name,
      mime: input.file.type || 'application/octet-stream',
      bytes: input.file.size,
      digestPrefix: digest.slice(0, 16),
      message: 'seam is real — drop replaced by real model in phase 2',
    };
    onProgress?.({ phase: 'done', message: 'echo complete' });
    yield output;
  }

  async dispose(): Promise<void> {
    await this.model?.dispose();
    this.model = undefined;
  }
}

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  if (typeof crypto !== 'undefined' && 'subtle' in crypto) {
    const digest = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  // Fallback for non-secure contexts: cheap non-crypto hash, hex-encoded.
  let h = 0xdeadbeef;
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) h = (h * 31 + (bytes[i] ?? 0)) | 0;
  return (h >>> 0).toString(16).padStart(16, '0');
}
