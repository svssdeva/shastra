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
registerBackend('wasm-candle', () => new WasmCandleBackend());

registerPipeline('echo', () => new EchoPipeline());
registerPipeline('ocr', () => new OcrPipeline());

bootstrap();
