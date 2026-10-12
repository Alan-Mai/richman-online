import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  VIEW_HOST,
  createViewServer,
  isAllowedHost,
  resolveRequestPath,
  type ViewRoots,
} from './view-server';

const roots: ViewRoots = {
  viewerDir: path.resolve('/srv/viewer'),
  mapsDir: path.resolve('/srv/assets/maps'),
};

describe('resolveRequestPath', () => {
  it('serves the viewer index at /', () => {
    expect(resolveRequestPath('/', roots)).toBe(path.join(roots.viewerDir, 'index.html'));
    expect(resolveRequestPath('/?map=1', roots)).toBe(path.join(roots.viewerDir, 'index.html'));
  });

  it('maps viewer files and /maps/ files to their roots', () => {
    expect(resolveRequestPath('/viewer.js', roots)).toBe(path.join(roots.viewerDir, 'viewer.js'));
    expect(resolveRequestPath('/maps/index.json', roots)).toBe(
      path.join(roots.mapsDir, 'index.json'),
    );
    expect(resolveRequestPath('/maps/0/background.png#x', roots)).toBe(
      path.join(roots.mapsDir, '0', 'background.png'),
    );
  });

  it('decodes percent-encoded names', () => {
    expect(resolveRequestPath('/maps/a%20b.json', roots)).toBe(
      path.join(roots.mapsDir, 'a b.json'),
    );
  });

  it('rejects path traversal in plain and encoded forms', () => {
    for (const target of [
      '/../secret.json',
      '/maps/../../secret.json',
      '/maps/0/../../x.json',
      '/%2e%2e/secret.json',
      '/maps/%2E%2E/%2e%2e/secret.json',
      '/maps/..%2fsecret.json',
      '/maps/..%5csecret.json',
      '/maps/0%5c..%5c..%5cx.json',
      '/C:%5cWindows%5cwin.ini',
      '/maps/C:/x.json',
      '/./index.html',
      '/maps//index.json',
      '/maps/x%00.json',
    ]) {
      expect(resolveRequestPath(target, roots), target).toBeNull();
    }
  });

  it('rejects malformed escapes, relative targets and the bare /maps/ directory', () => {
    expect(resolveRequestPath('/%E0%A4%A.json', roots)).toBeNull();
    expect(resolveRequestPath('index.html', roots)).toBeNull();
    expect(resolveRequestPath('http://evil/index.html', roots)).toBeNull();
    expect(resolveRequestPath('/maps', roots)).toBeNull();
    expect(resolveRequestPath('/maps/', roots)).toBeNull();
  });

  it('serves only known file types', () => {
    expect(resolveRequestPath('/maps/0/map.mkf', roots)).toBeNull();
    expect(resolveRequestPath('/maps/0', roots)).toBeNull();
    expect(resolveRequestPath('/maps/0/MAP.JSON', roots)).toBe(
      path.join(roots.mapsDir, '0', 'MAP.JSON'),
    );
  });
});

describe('isAllowedHost', () => {
  it('accepts only loopback hosts on the server port', () => {
    expect(isAllowedHost('127.0.0.1:5180', 5180)).toBe(true);
    expect(isAllowedHost('localhost:5180', 5180)).toBe(true);
    expect(isAllowedHost('127.0.0.1:5181', 5180)).toBe(false);
    expect(isAllowedHost('evil.example:5180', 5180)).toBe(false);
    expect(isAllowedHost(undefined, 5180)).toBe(false);
  });
});

describe('createViewServer', () => {
  let dir: string;
  let server: Server;
  let port: number;

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'view-server-'));
    const live: ViewRoots = {
      viewerDir: path.join(dir, 'viewer'),
      mapsDir: path.join(dir, 'assets', 'maps'),
    };
    mkdirSync(live.viewerDir, { recursive: true });
    mkdirSync(path.join(live.mapsDir, '0'), { recursive: true });
    writeFileSync(path.join(live.viewerDir, 'index.html'), '<p>viewer</p>');
    writeFileSync(path.join(live.mapsDir, '0', 'map.json'), '{"fake":true}');
    writeFileSync(path.join(dir, 'assets', 'secret.json'), '{"secret":true}');
    mkdirSync(path.join(live.mapsDir, 'dir.json'));
    server = createViewServer(live);
    await new Promise<void>((resolve) => server.listen(0, VIEW_HOST, resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  });

  /** Sends the target verbatim (no URL normalisation, unlike fetch). */
  function get(
    target: string,
    { method = 'GET', host = `${VIEW_HOST}:${port}` } = {},
  ): Promise<{ status: number; type: string | undefined; body: string }> {
    return new Promise((resolve, reject) => {
      const req = request(
        { host: VIEW_HOST, port, path: target, method, headers: { host } },
        (res) => {
          let body = '';
          res.setEncoding('utf8');
          res.on('data', (c: string) => (body += c));
          res.on('end', () =>
            resolve({ status: res.statusCode ?? 0, type: res.headers['content-type'], body }),
          );
        },
      );
      req.on('error', reject);
      req.end();
    });
  }

  it('serves the viewer and exported map files', async () => {
    expect(await get('/')).toMatchObject({ status: 200, body: '<p>viewer</p>' });
    expect(await get('/maps/0/map.json')).toMatchObject({
      status: 200,
      type: 'application/json; charset=utf-8',
      body: '{"fake":true}',
    });
  });

  it('does not leak files outside the roots', async () => {
    for (const target of [
      '/../assets/secret.json',
      '/maps/../secret.json',
      '/maps/%2e%2e/secret.json',
    ]) {
      const res = await get(target);
      expect(res.status, target).toBe(404);
      expect(res.body).not.toContain('secret');
    }
  });

  it('answers 404 for missing files and directories', async () => {
    expect((await get('/maps/9/map.json')).status).toBe(404);
    expect((await get('/maps/dir.json')).status).toBe(404);
  });

  it('rejects other methods and foreign Host headers', async () => {
    expect((await get('/', { method: 'POST' })).status).toBe(405);
    expect((await get('/', { host: 'evil.example' })).status).toBe(403);
  });

  it('answers HEAD without a body', async () => {
    expect(await get('/', { method: 'HEAD' })).toMatchObject({ status: 200, body: '' });
  });
});
