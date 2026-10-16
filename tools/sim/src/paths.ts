// Where command-line paths are resolved from: `pnpm -F sim` runs in tools/sim, but paths are
// typed relative to wherever pnpm was called.
import { resolve } from 'node:path';
import type { Command } from './args';

/**
 * The directory pnpm was called from: INIT_CWD, which pnpm sets for scripts, or `cwd` when run
 * without pnpm.
 */
export function invocationDir(
  env: Readonly<Record<string, string | undefined>>,
  cwd: string,
): string {
  const dir = env['INIT_CWD'];
  return dir === undefined || dir === '' ? cwd : dir;
}

/**
 * The command with --tables resolved against `dir`; other paths are left as they are (failure logs
 * are written to and replayed from tools/sim/out/, shown relative to tools/sim).
 */
export function withResolvedTables(command: Command, dir: string): Command {
  if (command.kind !== 'run' || command.options.tables === null) {
    return command;
  }
  return {
    ...command,
    options: { ...command.options, tables: resolve(dir, command.options.tables) },
  };
}
