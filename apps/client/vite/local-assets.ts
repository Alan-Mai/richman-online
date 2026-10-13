// Dev-server-only middleware that serves converted maps from the repo's local-assets/maps/.
// Nothing here runs in `vite build`, and nothing under local-assets/ is imported, so converted
// assets never reach the build output. Only loopback clients may read them, even when the dev
// server is exposed with `vite --host`.
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import type { Plugin } from 'vite';

export const ASSET_URL_PREFIX = '/local-assets/maps/';

const CONTENT_TYPES: Record<string, string> = {
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
};

/**
 * Maps a request target under ASSET_URL_PREFIX to a file under `mapsDir`, or null if it is not
 * allowed. Rejects ".", "..", empty segments, backslashes, colons and NUL after percent-decoding,
 * so neither "../" nor its encoded forms can leave the directory. Only .json and .png are served.
 */
export function resolveAssetPath(target: string, mapsDir: string): string | null {
  const pathname = target.split(/[?#]/, 1)[0] ?? '';
  if (!pathname.startsWith(ASSET_URL_PREFIX)) return null;

  let segments: string[];
  try {
    segments = pathname.slice(ASSET_URL_PREFIX.length).split('/').map(decodeURIComponent);
  } catch {
    return null;
  }
  if (segments.some((s) => s === '' || s === '.' || s === '..' || /[\\:\0]/.test(s))) {
    return null;
  }
  const last = segments.at(-1) ?? '';
  if (!(path.extname(last).toLowerCase() in CONTENT_TYPES)) return null;

  const file = path.resolve(mapsDir, ...segments);
  const rel = path.relative(mapsDir, file);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return file;
}

/** True for 127.0.0.0/8 and ::1, including IPv4-mapped IPv6 forms. */
export function isLoopbackAddress(address: string | undefined): boolean {
  if (address === undefined) return false;
  const v4 = address.startsWith('::ffff:') ? address.slice('::ffff:'.length) : address;
  return v4 === '::1' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(v4);
}

/** Accepts only Host headers naming a loopback name on this port, guarding against DNS rebinding. */
export function isLoopbackHost(host: string | undefined, port: number | undefined): boolean {
  if (host === undefined || port === undefined) return false;
  return [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`].includes(host.toLowerCase());
}

type Next = () => void;

/** Connect-style handler; requests outside ASSET_URL_PREFIX go to `next`. */
export function localAssetsMiddleware(mapsDir: string) {
  return (req: IncomingMessage, res: ServerResponse, next: Next): void => {
    const url = req.url ?? '';
    if (!url.startsWith(ASSET_URL_PREFIX)) {
      next();
      return;
    }
    const send = (status: number, text: string) => {
      res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(text);
    };
    if (
      !isLoopbackAddress(req.socket.remoteAddress) ||
      !isLoopbackHost(req.headers.host, req.socket.localPort)
    ) {
      send(403, 'local assets are only served to this computer');
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      send(405, 'method not allowed');
      return;
    }
    const file = resolveAssetPath(url, mapsDir);
    if (!file) {
      send(404, 'not found');
      return;
    }
    stat(file).then(
      (info) => {
        if (!info.isFile()) {
          send(404, 'not found');
          return;
        }
        res.writeHead(200, {
          'Content-Type':
            CONTENT_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
          'Content-Length': info.size,
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
        });
        if (req.method === 'HEAD') {
          res.end();
          return;
        }
        createReadStream(file).pipe(res);
      },
      () => send(404, 'not found'),
    );
  };
}

/** Vite plugin; `apply: 'serve'` keeps it out of `vite build` and `vite preview`. */
export function localAssetsPlugin(mapsDir: string): Plugin {
  return {
    name: 'richman-local-assets',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(localAssetsMiddleware(mapsDir));
    },
  };
}
