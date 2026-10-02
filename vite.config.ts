import { defineConfig, type Plugin } from 'vitest/config';
import react from '@vitejs/plugin-react';
import type { Server } from 'node:http';
import { attachParty, loadSongPools } from './server/party.ts';

/** Party rooms (server/party.ts) on the dev and preview servers too, so `npm run dev` is all you need to try them. */
function partyRooms(): Plugin {
  return {
    name: 'babel-beats-party',
    configureServer(server) {
      // Vitest also starts Vite, without an HTTP server; there is nothing to attach to then.
      if (server.httpServer) attachParty(server.httpServer as Server, loadSongPools(server.config.root));
    },
    configurePreviewServer(server) {
      attachParty(server.httpServer as Server, loadSongPools(server.config.root));
    },
  };
}

// `base: './'` keeps asset URLs relative, so the built site works from any static host or sub-path.
// The song lists (src/data/*.json, about 1 MB of text that gzips to roughly 160 kB) are bundled on purpose so the site
// stays a set of static files, hence the higher chunk-size warning limit.
export default defineConfig({
  base: './',
  plugins: [react(), partyRooms()],
  build: { chunkSizeWarningLimit: 1500 },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'server/**/*.test.ts', 'scripts/**/*.test.mjs'],
  },
});
