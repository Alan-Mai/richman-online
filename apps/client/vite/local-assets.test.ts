import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { afterAll, describe, expect, it } from 'vitest';
import {
  isLoopbackAddress,
  isLoopbackHost,
  localAssetsMiddleware,
  localAssetsPlugin,
  resolveAssetPath,
} from './local-assets';

// Synthetic stand-ins; no converted assets are used in tests.
const mapsDir = mkdtempSync(path.join(tmpdir(), 'richman-maps-'));
mkdirSync(path.join(mapsDir, '0'));
writeFileSync(path.join(mapsDir, 'index.json'), '{"maps":[0]}');
writeFileSync(path.join(mapsDir, '0', 'map.json'), '{"fake":true}');
writeFileSync(path.join(mapsDir, 'secret.txt'), 'no');
afterAll(() => rmSync(mapsDir, { recursive: true, force: true }));

describe('resolveAssetPath', () => {
  it('maps files under the prefix into the directory', () => {
    expect(resolveAssetPath('/local-assets/maps/0/map.json', mapsDir)).toBe(
      path.join(mapsDir, '0', 'map.json'),
    );
    expect(resolveAssetPath('/local-assets/maps/index.json?v=1', mapsDir)).toBe(
      path.join(mapsDir, 'index.json'),
    );
  });

  it.each([
    '/local-assets/maps/../inventory.json',
    '/local-assets/maps/%2e%2e/inventory.json',
    '/local-assets/maps/0/..%2f..%2finventory.json',
    '/local-assets/maps/0%5c..%5c..%5cinventory.json',
    '/local-assets/maps/C:/x.json',
    '/local-assets/maps//0/map.json',
    '/local-assets/maps/%E0%A4%A.json',
    '/local-assets/maps/0/map.json%00.png',
    '/local-assets/maps/',
    '/local-assets/inventory.json',
    '/src/main.ts',
  ])('rejects %s', (target) => {
    expect(resolveAssetPath(target, mapsDir)).toBeNull();
  });

  it('serves only .json and .png', () => {
    expect(resolveAssetPath('/local-assets/maps/secret.txt', mapsDir)).toBeNull();
    expect(resolveAssetPath('/local-assets/maps/0/background.PNG', mapsDir)).not.toBeNull();
  });
});

describe('isLoopbackAddress', () => {
  it.each(['127.0.0.1', '127.1.2.3', '::1', '::ffff:127.0.0.1'])('accepts %s', (a) => {
    expect(isLoopbackAddress(a)).toBe(true);
  });

  it.each(['192.168.1.20', '10.0.0.5', '::ffff:192.168.1.20', 'fe80::1', '', undefined])(
    'rejects %s',
    (a) => {
      expect(isLoopbackAddress(a)).toBe(false);
    },
  );
});

describe('isLoopbackHost', () => {
  it('accepts loopback names on the same port only', () => {
    expect(isLoopbackHost('127.0.0.1:5173', 5173)).toBe(true);
    expect(isLoopbackHost('localhost:5173', 5173)).toBe(true);
    expect(isLoopbackHost('[::1]:5173', 5173)).toBe(true);
    expect(isLoopbackHost('localhost:5174', 5173)).toBe(false);
    expect(isLoopbackHost('evil.example:5173', 5173)).toBe(false);
    expect(isLoopbackHost('192.168.1.20:5173', 5173)).toBe(false);
    expect(isLoopbackHost(undefined, 5173)).toBe(false);
  });
});

interface Reply {
  status: number;
  headers: Record<string, unknown>;
  body: string;
  nextCalled: boolean;
}

/** Runs the middleware on a fake request and collects the response. */
function request(
  url: string,
  {
    remote = '127.0.0.1',
    host = 'localhost:5173',
    method = 'GET',
  }: { remote?: string; host?: string; method?: string } = {},
): Promise<Reply> {
  return new Promise((resolve) => {
    const reply: Reply = { status: 0, headers: {}, body: '', nextCalled: false };
    const req = {
      url,
      method,
      headers: { host },
      socket: { remoteAddress: remote, localPort: 5173 },
    } as unknown as IncomingMessage;
    const sink = new PassThrough();
    const chunks: Buffer[] = [];
    sink.on('data', (c: Buffer) => chunks.push(c));
    sink.on('end', () => {
      reply.body = Buffer.concat(chunks).toString('utf8');
      resolve(reply);
    });
    const res = Object.assign(sink, {
      writeHead(status: number, headers: Record<string, unknown>) {
        reply.status = status;
        reply.headers = headers;
        return res;
      },
    }) as unknown as ServerResponse;
    localAssetsMiddleware(mapsDir)(req, res, () => {
      reply.nextCalled = true;
      resolve(reply);
    });
  });
}

describe('localAssetsMiddleware', () => {
  it('passes other requests on', async () => {
    expect((await request('/src/main.ts')).nextCalled).toBe(true);
  });

  it('serves a file to a loopback client', async () => {
    const reply = await request('/local-assets/maps/0/map.json');
    expect(reply.status).toBe(200);
    expect(reply.body).toBe('{"fake":true}');
    expect(reply.headers['Cache-Control']).toBe('no-store');
    expect(reply.headers['X-Content-Type-Options']).toBe('nosniff');
  });

  it('refuses LAN clients even with a loopback Host header (vite --host)', async () => {
    const reply = await request('/local-assets/maps/0/map.json', {
      remote: '192.168.1.20',
      host: 'localhost:5173',
    });
    expect(reply.status).toBe(403);
    expect(reply.body).not.toContain('fake');
  });

  it('refuses a LAN Host header from a loopback socket (DNS rebinding)', async () => {
    const reply = await request('/local-assets/maps/0/map.json', { host: 'evil.example:5173' });
    expect(reply.status).toBe(403);
  });

  it('refuses writes, traversal and missing files', async () => {
    expect((await request('/local-assets/maps/0/map.json', { method: 'POST' })).status).toBe(405);
    expect((await request('/local-assets/maps/%2e%2e/secret.json')).status).toBe(404);
    expect((await request('/local-assets/maps/9/map.json')).status).toBe(404);
    expect((await request('/local-assets/maps/0.json')).status).toBe(404);
  });
});

describe('localAssetsPlugin', () => {
  it('only applies to the dev server', () => {
    expect(localAssetsPlugin(mapsDir).apply).toBe('serve');
  });
});
