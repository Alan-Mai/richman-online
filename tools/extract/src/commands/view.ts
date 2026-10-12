import path from 'node:path';
import { VIEW_DEFAULT_PORT, VIEW_HOST, createViewServer } from '../view-server';
import type { CommandContext } from './inventory';

const viewerDir = path.resolve(import.meta.dirname, '../../viewer');

/** Serves the map viewer on 127.0.0.1 until interrupted: `view [port]`. */
export async function view({ outDir, args }: CommandContext): Promise<void> {
  const port = args[0] === undefined ? VIEW_DEFAULT_PORT : Number(args[0]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error(`error: invalid port "${args[0]}"`);
    process.exitCode = 1;
    return;
  }
  const server = createViewServer({ viewerDir, mapsDir: path.join(outDir, 'maps') });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, VIEW_HOST, resolve);
  });
  console.log(`map viewer: http://${VIEW_HOST}:${port}/  (Ctrl+C to stop)`);
  console.log('export maps first with: pnpm -F extract cli map');
}
