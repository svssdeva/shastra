import type { BackendId, PipelineId, PipelineProgress } from '../types.ts';
import type { ProcessPayload, WorkerRequest, WorkerResponse } from './protocol.ts';
import { nextId } from './protocol.ts';

/**
 * Main-thread client for the inference worker. Pending requests resolve when a `done: true`
 * result envelope arrives. Streaming pipelines emit each non-final result via `onChunk`.
 */
export interface PipelineClientOptions {
  worker: Worker;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  onProgress?: (p: PipelineProgress) => void;
  onChunk?: (chunk: unknown) => void;
}

export class PipelineClient {
  private readonly worker: Worker;
  private readonly pending = new Map<string, Pending>();

  constructor(opts: PipelineClientOptions) {
    this.worker = opts.worker;
    this.worker.addEventListener('message', this.onMessage);
  }

  private onMessage = (ev: MessageEvent<WorkerResponse>): void => {
    const res = ev.data;
    const p = this.pending.get(res.id);
    if (!p) return;
    if (res.kind === 'progress') {
      p.onProgress?.(res.progress);
      return;
    }
    if (res.kind === 'error') {
      this.pending.delete(res.id);
      p.reject(new Error(res.message));
      return;
    }
    if (!res.done) {
      p.onChunk?.(res.output);
      return;
    }
    this.pending.delete(res.id);
    p.resolve(res.output);
  };

  private call<T>(
    req: WorkerRequest,
    onProgress?: (p: PipelineProgress) => void,
    onChunk?: (chunk: unknown) => void,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.pending.set(req.id, {
        resolve: resolve as (v: unknown) => void,
        reject,
        onProgress,
        onChunk,
      });
      this.worker.postMessage(req);
    });
  }

  load(
    backend: BackendId,
    pipeline: PipelineId,
    onProgress?: (p: PipelineProgress) => void,
  ): Promise<{ loaded: boolean }> {
    return this.call({ kind: 'load', id: nextId(), backend, pipeline }, onProgress);
  }

  process<T>(
    input: ProcessPayload,
    onProgress?: (p: PipelineProgress) => void,
    onChunk?: (chunk: T) => void,
  ): Promise<T> {
    return this.call(
      { kind: 'process', id: nextId(), input },
      onProgress,
      onChunk as (c: unknown) => void,
    );
  }

  async dispose(): Promise<void> {
    await this.call({ kind: 'dispose', id: nextId() });
    this.worker.removeEventListener('message', this.onMessage);
    this.worker.terminate();
  }
}
