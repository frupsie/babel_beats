import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// `base: './'` keeps asset URLs relative, so the built site works from any static host or sub-path.
// The song lists (src/data/*.json, about 1 MB of text that gzips to roughly 160 kB) are bundled on purpose so the site
// stays a set of static files, hence the higher chunk-size warning limit.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: { chunkSizeWarningLimit: 1500 },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'scripts/**/*.test.mjs'],
  },
});
