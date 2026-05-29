import preact from '@astrojs/preact';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';

export default defineConfig({
  integrations: [preact({ compat: true })],
  vite: {
    plugins: [tailwindcss()],
    worker: { format: 'es' },
    // Pre-bundle transformers.js + tesseract.js for the dev server (they ship mixed CJS/ESM and
    // are dynamically imported from a worker). ORT Web is the opposite: its loader does
    // `await import('./ort-wasm-simd-threaded.jsep.mjs')` and the .mjs then resolves the .wasm
    // via `new URL('./...', import.meta.url)`. Pre-bundling rewrites those sibling paths and
    // breaks both the JS dynamic-import and the wasm fetch. Excluding ORT keeps it served from
    // its native `node_modules/onnxruntime-web/dist/` layout where all siblings line up. Vite
    // recognizes the `new URL(..., import.meta.url)` pattern and emits the wasm as a build
    // asset, so production `astro build` works the same way.
    optimizeDeps: {
      include: ['@huggingface/transformers', 'tesseract.js'],
      exclude: ['onnxruntime-web'],
    },
    // The transformers + ORT worker bundles ship their own WASM and use eval-based loaders;
    // tell Vite not to externalize them when bundling the inference worker.
    ssr: {
      noExternal: ['@huggingface/transformers', 'onnxruntime-web', 'tesseract.js'],
    },
  },
});
