/// <reference lib="webworker" />
import type { BackendId, InferenceBackend, Pipeline, PipelineId } from '../types.ts';
import type { ProcessPayload, WorkerRequest, WorkerResponse } from './protocol.ts';

/**
 * Worker host with a tiny registry. The app's worker entry calls `registerBackend` and
 * `registerPipeline` to wire concrete implementations, then `bootstrap()` to start listening.
 * This keeps inference-core free of pipeline / heavy-backend imports.
 */
declare const self: DedicatedWorkerGlobalScope;

type BackendFactory = () => InferenceBackend;
type PipelineFactory = () => Pipeline<unknown, unknown>;

const backendRegistry = new Map<BackendId, BackendFactory>();
const pipelineRegistry = new Map<PipelineId, PipelineFactory>();

let backend: InferenceBackend | undefined;
let pipeline: Pipeline<unknown, unknown> | undefined;
let bootstrapped = false;

export function registerBackend(id: BackendId, factory: BackendFactory): void {
  backendRegistry.set(id, factory);
}

export function registerPipeline(id: PipelineId, factory: PipelineFactory): void {
  pipelineRegistry.set(id, factory);
}

function instantiateBackend(id: BackendId): InferenceBackend {
  const factory = backendRegistry.get(id);
  if (!factory) throw new Error(`worker: backend '${id}' is not registered`);
  return factory();
}

function instantiatePipeline(id: PipelineId): Pipeline<unknown, unknown> {
  const factory = pipelineRegistry.get(id);
  if (!factory) throw new Error(`worker: pipeline '${id}' is not registered`);
  return factory();
}

function send(res: WorkerResponse): void {
  self.postMessage(res);
}

function reconstructInput(payload: ProcessPayload): unknown {
  if (payload.fileBlob && payload.fileName) {
    return {
      file: new File([payload.fileBlob], payload.fileName, {
        type: payload.fileType ?? 'application/octet-stream',
      }),
    };
  }
  throw new Error('worker: process payload missing fileBlob');
}

async function handle(req: WorkerRequest): Promise<void> {
  try {
    switch (req.kind) {
      case 'load': {
        await pipeline?.dispose();
        await backend?.dispose();
        backend = instantiateBackend(req.backend);
        pipeline = instantiatePipeline(req.pipeline);
        await pipeline.load(backend, (progress) =>
          send({ kind: 'progress', id: req.id, progress }),
        );
        send({ kind: 'result', id: req.id, output: { loaded: true }, done: true });
        return;
      }
      case 'process': {
        if (!pipeline) throw new Error('worker: load before process');
        const input = reconstructInput(req.input);
        const stream = pipeline.process(input, (progress) =>
          send({ kind: 'progress', id: req.id, progress }),
        );
        let lastOutput: unknown;
        for await (const out of stream) {
          lastOutput = out;
          send({ kind: 'result', id: req.id, output: out, done: false });
        }
        send({ kind: 'result', id: req.id, output: lastOutput, done: true });
        return;
      }
      case 'dispose': {
        await pipeline?.dispose();
        await backend?.dispose();
        pipeline = undefined;
        backend = undefined;
        send({ kind: 'result', id: req.id, output: { disposed: true }, done: true });
        return;
      }
    }
  } catch (err) {
    send({ kind: 'error', id: req.id, message: err instanceof Error ? err.message : String(err) });
  }
}

export function bootstrap(): void {
  if (bootstrapped) return;
  bootstrapped = true;
  self.addEventListener('message', (ev: MessageEvent<WorkerRequest>) => {
    void handle(ev.data);
  });
}
