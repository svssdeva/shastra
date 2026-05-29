import { expect, test } from 'bun:test';
import { WasmCandleBackend } from '../src/backend.ts';
import { INFERENCE_CORE_WASM_VERSION } from '../src/index.ts';

test('inference-core-wasm version is published', () => {
  expect(INFERENCE_CORE_WASM_VERSION).toMatch(/^\d+\.\d+\.\d+/);
});

test('WasmCandleBackend identifies itself correctly', () => {
  const b = new WasmCandleBackend();
  expect(b.id).toBe('wasm-candle');
  expect(b.label).toContain('Candle');
});
