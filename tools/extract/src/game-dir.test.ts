import { describe, expect, it } from 'vitest';
import { GameDirError, resolveGameDir, type GameDirOptions } from './game-dir';

function opts(
  platform: GameDirOptions['platform'],
  repoRoot: string,
  dirs: string[],
): GameDirOptions {
  return { platform, repoRoot, isDirectory: (p) => dirs.includes(p) };
}

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    if (e instanceof GameDirError) return e.code;
    throw e;
  }
  return undefined;
}

describe('resolveGameDir (win32)', () => {
  const o = opts('win32', 'C:\\Users\\dev\\richman-online', ['C:\\Games\\Richman4']);

  it('accepts an absolute drive path', () => {
    expect(resolveGameDir('C:\\Games\\Richman4', o)).toBe('C:\\Games\\Richman4');
  });

  it('normalizes forward slashes and trailing separators', () => {
    expect(resolveGameDir('C:/Games/Richman4/', o)).toBe('C:\\Games\\Richman4');
  });

  it('accepts a UNC path', () => {
    const unc = opts('win32', 'C:\\repo', ['\\\\nas\\games\\Richman4']);
    expect(resolveGameDir('\\\\nas\\games\\Richman4', unc)).toBe('\\\\nas\\games\\Richman4');
  });

  it.each([
    ['relative', 'Richman4'],
    ['dot-relative', '.\\Richman4'],
    ['drive-relative', 'C:Games\\Richman4'],
    ['rooted without drive', '\\Games\\Richman4'],
    ['POSIX absolute', '/opt/richman4'],
  ])('rejects %s path', (_label, raw) => {
    expect(codeOf(() => resolveGameDir(raw, o))).toBe('NOT_ABSOLUTE');
  });

  it('rejects a path inside the repository, case-insensitively', () => {
    const inRepo = opts('win32', 'C:\\Users\\dev\\richman-online', [
      'C:\\Users\\dev\\richman-online\\game',
    ]);
    expect(codeOf(() => resolveGameDir('c:\\users\\DEV\\richman-online\\game', inRepo))).toBe(
      'INSIDE_REPO',
    );
  });

  it('accepts a sibling folder whose name starts with the repo name', () => {
    const sibling = opts('win32', 'C:\\work\\richman-online', ['C:\\work\\richman-online-game']);
    expect(resolveGameDir('C:\\work\\richman-online-game', sibling)).toBe(
      'C:\\work\\richman-online-game',
    );
  });

  it('rejects a missing directory', () => {
    expect(codeOf(() => resolveGameDir('D:\\Nope', o))).toBe('NOT_FOUND');
  });
});

describe('resolveGameDir (posix)', () => {
  const o = opts('posix', '/home/dev/richman-online', ['/opt/richman4']);

  it('accepts an absolute path', () => {
    expect(resolveGameDir('/opt/richman4/', o)).toBe('/opt/richman4');
  });

  it.each([
    ['relative', 'richman4'],
    ['dot-relative', './richman4'],
    ['Windows drive', 'C:\\Games\\Richman4'],
  ])('rejects %s path', (_label, raw) => {
    expect(codeOf(() => resolveGameDir(raw, o))).toBe('NOT_ABSOLUTE');
  });

  it('rejects the repository root itself', () => {
    const root = opts('posix', '/home/dev/richman-online', ['/home/dev/richman-online']);
    expect(codeOf(() => resolveGameDir('/home/dev/richman-online', root))).toBe('INSIDE_REPO');
  });

  it('is case-sensitive about repository containment', () => {
    const o2 = opts('posix', '/home/dev/richman-online', ['/home/dev/Richman-Online/game']);
    expect(resolveGameDir('/home/dev/Richman-Online/game', o2)).toBe(
      '/home/dev/Richman-Online/game',
    );
  });

  it('rejects a missing directory', () => {
    expect(codeOf(() => resolveGameDir('/nope', o))).toBe('NOT_FOUND');
  });
});

describe('resolveGameDir (unset)', () => {
  it.each([undefined, '', '   '])('rejects %j', (raw) => {
    expect(codeOf(() => resolveGameDir(raw, opts('posix', '/repo', [])))).toBe('UNSET');
  });
});
