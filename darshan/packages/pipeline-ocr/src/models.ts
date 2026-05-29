import type { ModelSpec } from '@darshan/inference-core';

/**
 * Model registry for the OCR pipeline. Bytes are best-effort estimates from HF model cards —
 * the cache writes the real bytes; we use these only for the progress meter total.
 *
 * Devanagari coverage trade-off: TrOCR-printed is English-trained; for production we'd ship a
 * Sanskrit-OCR ONNX export. v1 ships with TrOCR-small-printed as the proof-of-pipeline; the
 * recognizer is swappable via `OcrPipeline`'s constructor.
 */
export const RECOGNIZER_TROCR_PRINTED: ModelSpec = {
  id: 'Xenova/trocr-small-printed',
  task: 'image-to-text',
  quantization: 'q8',
  files: [{ path: 'model.onnx', bytes: 62 * 1024 * 1024 }],
};

export const RECOGNIZER_TROCR_HANDWRITTEN: ModelSpec = {
  id: 'Xenova/trocr-small-handwritten',
  task: 'image-to-text',
  quantization: 'q8',
  files: [{ path: 'model.onnx', bytes: 62 * 1024 * 1024 }],
};

/**
 * Hindi → English translation. Opus-MT is small (~80 MB q8) and serviceable; NLLB-distilled
 * gives better quality at ~250 MB q4. The pipeline accepts either; default favors size.
 */
export const TRANSLATOR_OPUS_HI_EN: ModelSpec = {
  id: 'Xenova/opus-mt-hi-en',
  task: 'translation',
  quantization: 'q8',
  files: [{ path: 'model.onnx', bytes: 80 * 1024 * 1024 }],
};

export const TRANSLATOR_NLLB_DISTILLED: ModelSpec = {
  id: 'Xenova/nllb-200-distilled-600M',
  task: 'translation',
  quantization: 'q4',
  files: [{ path: 'model.onnx', bytes: 250 * 1024 * 1024 }],
};
