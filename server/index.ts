// The production server: serves the built site from dist/ and runs party rooms at /party, on one port.
//   npm run build && npm start        (PORT defaults to 3000)
// Static hosts (Vercel, Netlify, GitHub Pages...) can serve the site but not party rooms, which need this long-running
// process; see the README for hosts that can run it.
import { createReadStream, existsSync, statSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PARTY_PATH, attachParty, loadSongPools } from './party.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const PORT = process.env.PORT === undefined ? 3000 : Number(process.env.PORT); // PORT=0 picks a free port (tests)
const HOST = process.env.HOST ?? '0.0.0.0';

if (!existsSync(path.join(DIST, 'index.html'))) {
  console.error('dist/index.html is missing: run `npm run build` first.');
  process.exit(1);
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

/** The file in dist/ a URL path points at, or null. Never anything outside dist/. */
function fileFor(urlPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  const file = path.resolve(DIST, `.${decoded}`);
  if (file !== DIST && !file.startsWith(DIST + path.sep)) return null;
  try {
    return statSync(file).isFile() ? file : null;
  } catch {
    return null;
  }
}

const server = http.createServer((req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }
  const { pathname } = new URL(req.url ?? '/', 'http://localhost');
  if (pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }).end('ok');
    return;
  }

  let file = fileFor(pathname === '/' ? '/index.html' : pathname);
  // The game is one page: any other path without a file extension (e.g. a shared room link) gets it too.
  if (!file && !path.extname(pathname)) file = path.join(DIST, 'index.html');
  if (!file) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
    return;
  }

  // Built assets have a content hash in their name, so they never change; the page itself must always be fresh.
  const cache = file.startsWith(path.join(DIST, 'assets') + path.sep) ? 'public, max-age=31536000, immutable' : 'no-cache';
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': cache });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  createReadStream(file).pipe(res);
});

const party = attachParty(server, loadSongPools(ROOT));
// Any other WebSocket request is not ours: hang up rather than leave it open.
server.on('upgrade', (req, socket) => {
  if (new URL(req.url ?? '/', 'http://localhost').pathname !== PARTY_PATH) socket.destroy();
});

server.listen(PORT, HOST, () => {
  const { port } = server.address() as { port: number };
  console.info(`Babel Beats on http://localhost:${port} (party rooms at ${PARTY_PATH})`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    party.close();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
