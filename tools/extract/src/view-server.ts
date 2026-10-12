// Local-only static file server for the map viewer (`pnpm -F extract cli view`).
// Serves tools/extract/viewer/ at "/" and local-assets/maps/ at "/maps/"; nothing else.
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import path from 'node:path';

export const VIEW_HOST = '127.0.0.1';
export const VIEW_DEFAULT_PORT = 5180;

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
};

export interface ViewRoots {
  /** Absolute path of tools/extract/viewer. */
  viewerDir: string;
  /** Absolute path of local-assets/maps. */
  mapsDir: string;
}

/**
 * Maps a request target to a file under one of the roots, or null if it is not allowed.
 * Rejects ".", "..", empty segments, backslashes, colons and NUL after percent-decoding,
 * so neither "../" nor its encoded forms can leave the roots. Only listed file types are served.
 */
export function resolveRequestPath(target: string, roots: ViewRoots): string | null {
  const pathname = target.split(/[?#]/, 1)[0]!;
  if (!pathname.startsWith('/')) return null;

  let segments: string[];
  try {
    segments = pathname.slice(1).split('/').map(decodeURIComponent);
  } catch {
    return null;
  }
  if (segments.length === 1 && segments[0] === '') segments = ['index.html'];
  if (segments.some((s) => s === '' || s === '.' || s === '..' || /[\\:\0]/.test(s))) {
    return null;
  }

  let root = roots.viewerDir;
  if (segments[0] === 'maps') {
    root = roots.mapsDir;
    segments = segments.slice(1);
    if (segments.length === 0) return null;
  }
  if (!(path.extname(segments.at(-1)!).toLowerCase() in CONTENT_TYPES)) return null;

  const file = path.resolve(root, ...segments);
  const rel = path.relative(root, file);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return file;
}

/** Accepts only Host headers naming the loopback address, guarding against DNS rebinding. */
export function isAllowedHost(host: string | undefined, port: number): boolean {
  return host === `${VIEW_HOST}:${port}` || host === `localhost:${port}`;
}

/** Creates the server; call listen(port, VIEW_HOST) on it. */
export function createViewServer(roots: ViewRoots): Server {
  const server = createServer((req, res) => {
    const send = (status: number, text: string) => {
      res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(text);
    };
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    if (!isAllowedHost(req.headers.host, port)) return send(403, 'forbidden host');
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, 'method not allowed');

    const file = resolveRequestPath(req.url ?? '', roots);
    if (!file) return send(404, 'not found');
    stat(file).then(
      (info) => {
        if (!info.isFile()) return send(404, 'not found');
        res.writeHead(200, {
          'Content-Type': CONTENT_TYPES[path.extname(file).toLowerCase()]!,
          'Content-Length': info.size,
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
        });
        if (req.method === 'HEAD') return res.end();
        createReadStream(file).pipe(res);
      },
      () => send(404, 'not found'),
    );
  });
  return server;
}
