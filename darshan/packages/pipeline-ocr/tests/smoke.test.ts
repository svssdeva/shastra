import { expect, test } from 'bun:test';
import { OcrPipeline, PIPELINE_OCR_VERSION } from '../src/index.ts';
import { RECOGNIZER_TROCR_PRINTED, TRANSLATOR_OPUS_HI_EN } from '../src/models.ts';

test('pipeline-ocr version is published', () => {
  expect(PIPELINE_OCR_VERSION).toMatch(/^\d+\.\d+\.\d+/);
});

test('OcrPipeline picks the configured model specs', () => {
  const p = new OcrPipeline();
  expect(p.id).toBe('ocr');
  expect(p.label).toContain('Devanagari');
});

test('Model registry exports the expected HF model ids', () => {
  expect(RECOGNIZER_TROCR_PRINTED.id).toBe('Xenova/trocr-small-printed');
  expect(TRANSLATOR_OPUS_HI_EN.id).toBe('Xenova/opus-mt-hi-en');
  expect(TRANSLATOR_OPUS_HI_EN.task).toBe('translation');
});
