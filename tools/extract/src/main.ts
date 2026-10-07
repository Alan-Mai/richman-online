// Asset extraction CLI. Commands are added in Phase 1.
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { GameDirError, resolveGameDir } from './game-dir';

const repoRoot = path.resolve(import.meta.dirname, '../../..');

const envFile = path.join(repoRoot, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

try {
  const gameDir = resolveGameDir(process.env.RICHMAN4_DIR, {
    platform: process.platform === 'win32' ? 'win32' : 'posix',
    repoRoot,
    isDirectory: (p) => statSync(p, { throwIfNoEntry: false })?.isDirectory() ?? false,
  });
  console.log(`RICHMAN4_DIR: ${gameDir}`);
  console.log('usage: pnpm -F extract cli <command>');
} catch (e) {
  if (!(e instanceof GameDirError)) throw e;
  console.error(`error: ${e.message}`);
  process.exitCode = 1;
}
