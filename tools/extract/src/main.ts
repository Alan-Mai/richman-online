// Asset extraction CLI: pnpm -F extract cli <command>
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { inventory, type CommandContext } from './commands/inventory';
import { GameDirError, resolveGameDir } from './game-dir';

const COMMANDS: Record<string, (ctx: CommandContext) => Promise<void>> = {
  inventory,
};

const repoRoot = path.resolve(import.meta.dirname, '../../..');
const outDir = path.join(repoRoot, 'local-assets');

const envFile = path.join(repoRoot, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

function fail(message: string): void {
  console.error(`error: ${message}`);
  process.exitCode = 1;
}

async function main(): Promise<void> {
  let gameDir: string;
  try {
    gameDir = resolveGameDir(process.env.RICHMAN4_DIR, {
      platform: process.platform === 'win32' ? 'win32' : 'posix',
      repoRoot,
      isDirectory: (p) => statSync(p, { throwIfNoEntry: false })?.isDirectory() ?? false,
    });
  } catch (e) {
    if (e instanceof GameDirError) return fail(e.message);
    throw e;
  }

  // Output must never land inside the read-only game directory.
  const rel = path.relative(gameDir, outDir);
  if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) {
    return fail(`output directory ${outDir} is inside RICHMAN4_DIR`);
  }

  const name = process.argv[2];
  const command = name === undefined ? undefined : COMMANDS[name];
  if (!command) {
    console.log(`RICHMAN4_DIR: ${gameDir}`);
    console.log(`usage: pnpm -F extract cli <${Object.keys(COMMANDS).join('|')}>`);
    if (name !== undefined) fail(`unknown command "${name}"`);
    return;
  }

  await command({ gameDir, outDir });
}

await main();
