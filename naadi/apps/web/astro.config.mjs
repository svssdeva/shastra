import preact from '@astrojs/preact';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';

export default defineConfig({
  // Pure static: every page is prerendered. Deploys anywhere — CDN, GH Pages,
  // S3, Cloudflare Pages, even file://. Room IDs live in the URL fragment
  // (/r#<32hex>) so we don't need a dynamic server route.
  output: 'static',
  integrations: [preact({ compat: true })],
  vite: {
    plugins: [tailwindcss()],
    // Vite's dep pre-bundler mishandles loro-crdt's bundled WASM in dev mode
    // (404 on /node_modules/.vite/deps/loro_wasm_bg.wasm). Excluding it from
    // optimization lets Vite serve the package's own bundler/ files directly.
    optimizeDeps: {
      exclude: ['loro-crdt'],
    },
    worker: { format: 'es' },
    assetsInclude: ['**/*.wgsl'],
  },
});
