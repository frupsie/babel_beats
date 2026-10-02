// Runs the real production server (node server/index.ts) against the built site, as a host would.
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { DEFAULT_PARTY_SETTINGS, type ServerMsg } from '../src/party/protocol.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const built = existsSync(path.join(ROOT, 'dist', 'index.html'));

let child: ChildProcess;
let base = '';

describe.skipIf(!built)('production server (needs `npm run build`)', () => {
  beforeAll(async () => {
    child = spawn(process.execPath, ['server/index.ts'], { cwd: ROOT, env: { ...process.env, PORT: '0', HOST: '127.0.0.1' } });
    base = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('server did not start')), 10_000);
      child.stdout!.on('data', (d: Buffer) => {
        const port = /localhost:(\d+)/.exec(d.toString())?.[1];
        if (port) (clearTimeout(timer), resolve(`http://127.0.0.1:${port}`));
      });
      child.on('exit', (code) => reject(new Error(`server exited (${code})`)));
    });
  }, 15_000);

  afterAll(() => {
    child?.kill();
  });

  it('serves the game page, never cached', async () => {
    const res = await fetch(`${base}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
    expect(res.headers.get('cache-control')).toBe('no-cache');
    expect(await res.text()).toContain('<div id="root">');
  });

  it('serves built assets with long caching', async () => {
    const html = await (await fetch(`${base}/`)).text();
    const js = /src="\.?\/?(assets\/[^"]+\.js)"/.exec(html)?.[1];
    expect(js).toBeTruthy();
    const res = await fetch(`${base}/${js}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/javascript/);
    expect(res.headers.get('cache-control')).toMatch(/immutable/);
  });

  it('answers a health check', async () => {
    expect(await (await fetch(`${base}/healthz`)).text()).toBe('ok');
  });

  it('serves the page for a room link, 404s missing files, and never leaves dist/', async () => {
    expect((await fetch(`${base}/play?room=ABCD`)).status).toBe(200);
    expect((await fetch(`${base}/missing.js`)).status).toBe(404);
    for (const sneaky of ['/..%2fpackage.json', '/%2e%2e/package.json', '/assets/..%2f..%2fpackage.json']) {
      const res = await fetch(`${base}${sneaky}`);
      expect(await res.text(), sneaky).not.toContain('"name": "babel-beats"');
    }
  });

  it('refuses other HTTP methods', async () => {
    expect((await fetch(`${base}/`, { method: 'POST' })).status).toBe(405);
  });

  it('runs party rooms at /party', async () => {
    const ws = new WebSocket(`${base.replace('http', 'ws')}/party`);
    await new Promise((resolve, reject) => (ws.once('open', resolve), ws.once('error', reject)));
    const reply = new Promise<ServerMsg>((resolve) => ws.once('message', (d) => resolve(JSON.parse(d.toString()) as ServerMsg)));
    ws.send(JSON.stringify({ t: 'create', secret: 'production-test-secret', name: 'Ann', settings: DEFAULT_PARTY_SETTINGS }));
    const msg = await reply;
    ws.close();
    expect(msg.t).toBe('state');
    if (msg.t === 'state') expect(msg.state.players[0]!.name).toBe('Ann');
  });
});
