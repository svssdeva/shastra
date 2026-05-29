/**
 * The two load-bearing seams of darshan.
 *
 * - {@link InferenceBackend} — swappable runtime (transformers.js, onnxruntime-web, future Rust/WASM).
 * - {@link Pipeline} — swappable task (OCR, dashcam, future).
 *
 * Pipelines never call backends directly; they receive a `LoadedModel`. Backends never know
 * what pipeline they're serving. The two are composed at the `Shell` boundary.
 */

export type BackendId = 'mock' | 'transformers-js' | 'onnxruntime-web' | 'wasm-candle';
export type PipelineId = 'echo' | 'ocr' | 'dashcam';
export type TaskKind = 'image-to-text' | 'object-detection' | 'translation' | 'echo';
export type Quantization = 'fp32' | 'fp16' | 'q8' | 'q4';

export interface BackendCapabilities {
  webgpu: boolean;
  webgl: boolean;
  wasm: boolean;
}

export interface ModelFile {
  path: string;
  bytes: number;
  /** Optional sha256 for integrity. Cache API verifies download size; sha256 is stronger. */
  sha256?: string;
}

export interface ModelSpec {
  id: string;
  task: TaskKind;
  quantization?: Quantization;
  files: readonly ModelFile[];
}

export interface LoadOptions {
  /** Called with bytes-loaded / bytes-total during fetch + warmup. */
  onProgress?: (p: LoadProgress) => void;
  /** Abort the load (e.g., user cancelled). */
  signal?: AbortSignal;
}

export interface LoadProgress {
  phase: 'fetch' | 'warmup' | 'ready';
  loaded: number;
  total: number;
  message?: string;
}

export interface RunOptions {
  signal?: AbortSignal;
}

export interface LoadedModel<I = unknown, O = unknown> {
  readonly spec: ModelSpec;
  readonly backendId: BackendId;
  run(input: I, opts?: RunOptions): Promise<O>;
  dispose(): Promise<void>;
}

export interface InferenceBackend {
  readonly id: BackendId;
  readonly label: string;
  readonly capabilities: BackendCapabilities;
  load<I, O>(spec: ModelSpec, opts?: LoadOptions): Promise<LoadedModel<I, O>>;
  dispose(): Promise<void>;
}

export type PipelineProgress =
  | { phase: 'idle' }
  | { phase: 'loading'; message: string; loaded: number; total: number }
  | { phase: 'running'; message: string; loaded: number; total: number }
  | { phase: 'done'; message: string }
  | { phase: 'error'; message: string };

export interface Pipeline<TInput = unknown, TOutput = unknown> {
  readonly id: PipelineId;
  readonly label: string;
  readonly inputKind: 'image' | 'video' | 'any';
  load(backend: InferenceBackend, onProgress?: (p: PipelineProgress) => void): Promise<void>;
  /**
   * Stream results. Single-shot pipelines (OCR) yield once; streaming pipelines (dashcam)
   * yield per-frame.
   */
  process(input: TInput, onProgress?: (p: PipelineProgress) => void): AsyncIterable<TOutput>;
  dispose(): Promise<void>;
}

export class InferenceError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'InferenceError';
  }
}
