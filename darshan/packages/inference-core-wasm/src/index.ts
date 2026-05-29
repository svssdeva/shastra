export { WasmCandleBackend } from './backend.ts';
export type { WasmModule } from './wasm-loader.ts';
export { loadWasmModule, resetWasmCacheForTesting } from './wasm-loader.ts';
export const INFERENCE_CORE_WASM_VERSION = '0.1.0';
