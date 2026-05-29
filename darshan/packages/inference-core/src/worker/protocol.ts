import type { BackendId, PipelineId, PipelineProgress } from '../types.ts';

/**
 * Wire protocol between the main thread and the inference worker. Kept deliberately tiny — no
 * Comlink dependency. Every request gets a unique id; the response correlates by id. Progress
 * events stream out-of-band on the same channel with `kind: 'progress'`.
 */

export type WorkerRequest =
  | { kind: 'load'; id: string; backend: BackendId; pipeline: PipelineId }
  | { kind: 'process'; id: string; input: ProcessPayload }
  | { kind: 'dispose'; id: string };

export type WorkerResponse =
  | { kind: 'progress'; id: string; progress: PipelineProgress }
  | { kind: 'result'; id: string; output: unknown; done: boolean }
  | { kind: 'error'; id: string; message: string };

export interface ProcessPayload {
  /** Serializable description of input; the worker reconstructs as needed. */
  fileBlob?: Blob;
  fileName?: string;
  fileType?: string;
}

export function nextId(): string {
  return Math.random().toString(36).slice(2);
}
