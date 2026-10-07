import path from 'node:path';

export type GameDirErrorCode = 'UNSET' | 'NOT_ABSOLUTE' | 'INSIDE_REPO' | 'NOT_FOUND';

export class GameDirError extends Error {
  constructor(
    readonly code: GameDirErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'GameDirError';
  }
}

export interface GameDirOptions {
  /** Path semantics to apply. Injected so both platforms are testable anywhere. */
  platform: 'win32' | 'posix';
  /** Absolute path of this repository; the game dir must live outside it. */
  repoRoot: string;
  isDirectory: (p: string) => boolean;
}

// On Windows, require a drive letter ("C:\") or a UNC share ("\\server\share").
// path.win32.isAbsolute also accepts "\foo", which depends on the current drive.
const WIN32_FULLY_QUALIFIED = /^(?:[A-Za-z]:[\\/]|[\\/]{2}[^\\/]+[\\/][^\\/]+)/;

/**
 * Validate RICHMAN4_DIR. Returns the normalized absolute path or throws GameDirError.
 * The original game directory is read-only input and must sit outside the repository.
 */
export function resolveGameDir(raw: string | undefined, opts: GameDirOptions): string {
  const p = opts.platform === 'win32' ? path.win32 : path.posix;
  const value = raw?.trim() ?? '';

  if (value === '') {
    throw new GameDirError('UNSET', 'RICHMAN4_DIR is not set. Copy .env.example to .env.');
  }

  const absolute =
    opts.platform === 'win32' ? WIN32_FULLY_QUALIFIED.test(value) : p.isAbsolute(value);
  if (!absolute) {
    throw new GameDirError(
      'NOT_ABSOLUTE',
      `RICHMAN4_DIR must be an absolute path, got "${value}".`,
    );
  }

  const resolved = p.resolve(value);

  const rel = p.relative(p.resolve(opts.repoRoot), resolved);
  if (rel === '' || (!rel.startsWith('..') && !p.isAbsolute(rel))) {
    throw new GameDirError(
      'INSIDE_REPO',
      `RICHMAN4_DIR must be outside the repository, got "${resolved}".`,
    );
  }

  if (!opts.isDirectory(resolved)) {
    throw new GameDirError('NOT_FOUND', `RICHMAN4_DIR does not exist: "${resolved}".`);
  }

  return resolved;
}
