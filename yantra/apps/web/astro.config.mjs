import { defineConfig } from 'astro/config';
import preact from '@astrojs/preact';

export default defineConfig({
  integrations: [preact({ compat: true })],
  vite: {
    worker: { format: 'es' },
    assetsInclude: ['**/*.wgsl'],
  },
});
