/// <reference lib="webworker" />
import {
  bootstrap,
  EchoPipeline,
  MockBackend,
  registerBackend,
  registerPipeline,
  TransformersJsBackend,
} from '@darshan/inference-core';
import { WasmCandleBackend } from '@darshan/inference-core-wasm';
import { OcrPipeline } from '@darshan/pipeline-ocr';

// Dashcam runs on the main thread because it decodes video through an HTMLVideoElement, which
// has no equivalent in DedicatedWorkerGlobalScope. Inference itself still runs on the GPU via
// the WebGPU execution provider; the main thread blocks only on negligible per-frame glue.

registerBackend('mock', () => new MockBackend());
registerBackend('transformers-js', () => new TransformersJsBackend());
// Site is served from a sub-path (e.g. /projects/darshan/), so the WASM artifact must be fetched
// with the base prefix. import.meta.env.BASE_URL is statically replaced by Vite in this worker.
registerBackend(
  'wasm-candle',
  () => new WasmCandleBackend(`${import.meta.env.BASE_URL}wasm/darshan-inference-core.wasm`),
);

registerPipeline('echo', () => new EchoPipeline());
registerPipeline('ocr', () => new OcrPipeline());

bootstrap();
