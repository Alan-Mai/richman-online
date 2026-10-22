import { isAbsolute, relative, resolve } from 'node:path';

export interface SmokeArgs {
  /** Directory for screenshots; always outside the repository. */
  out: string;
  /** How long the all-computer game runs before the last screenshot. */
  seconds: number;
}

export type ParseResult = { ok: true; args: SmokeArgs } | { ok: false; error: string };

export const USAGE =
  'Usage: pnpm -F smoke shot -- --out <absolute dir outside the repo> [--seconds 8]';

/** True when `dir` is `root` itself or inside it. */
export function isInside(root: string, dir: string): boolean {
  const rel = relative(resolve(root), resolve(dir));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

export function parseArgs(argv: readonly string[], repoRoot: string): ParseResult {
  let out: string | undefined;
  let seconds = 8;
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === '--') continue;
    if ((flag === '--out' || flag === '--seconds') && value === undefined) {
      return { ok: false, error: `${flag} needs a value` };
    }
    if (flag === '--out') {
      out = value;
      i++;
    } else if (flag === '--seconds') {
      seconds = Number(value);
      i++;
      if (!Number.isInteger(seconds) || seconds < 1 || seconds > 120) {
        return { ok: false, error: '--seconds must be an integer from 1 to 120' };
      }
    } else {
      return { ok: false, error: `unknown argument: ${flag}` };
    }
  }
  if (out === undefined) return { ok: false, error: '--out is required' };
  // Screenshots may show imported original assets, so they never go into the repository.
  if (!isAbsolute(out)) return { ok: false, error: '--out must be an absolute path' };
  if (isInside(repoRoot, out)) return { ok: false, error: '--out must be outside the repository' };
  return { ok: true, args: { out: resolve(out), seconds } };
}
