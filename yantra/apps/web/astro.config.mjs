import { defineConfig } from 'astro/config';
import preact from '@astrojs/preact';

export default defineConfig({
  // Served from a sub-path behind CloudFront: beyondcodekarma.in/projects/yantra/.
  // `base` prefixes all Astro-emitted asset URLs; hand-written links/fetches must
  // use import.meta.env.BASE_URL (which equals this value, trailing slash included).
  base: '/projects/yantra/',
  integrations: [preact({ compat: true })],
  vite: {
    worker: { format: 'es' },
    assetsInclude: ['**/*.wgsl'],
  },
});
