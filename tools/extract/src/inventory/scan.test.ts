import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { scanDir } from './scan';

const BLOCK = 64 * 1024;

function bytes(length: number, at: (i: number) => number): Uint8Array {
  return Uint8Array.from({ length }, (_, i) => at(i));
}

let root: string;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'richman-inventory-'));
  await mkdir(path.join(root, 'Sub', 'Deep'), { recursive: true });
  // Synthetic fixtures only; never original game files.
  await writeFile(path.join(root, 'ZERO.DAT'), new Uint8Array(BLOCK + 100));
  await writeFile(
    path.join(root, 'Sub', 'mixed.bin'),
    bytes(2 * BLOCK, (i) => (i < BLOCK ? 0 : i % 256)),
  );
  await writeFile(path.join(root, 'Sub', 'Deep', 'tiny.Txt'), 'RIFF');
  await writeFile(path.join(root, 'empty'), new Uint8Array(0));
  await writeFile(
    path.join(root, 'a.mkf'),
    bytes(32, (i) => i),
  );
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('scanDir', () => {
  it('lists files sorted with POSIX-style relative paths', async () => {
    const { files } = await scanDir(root);
    expect(files.map((f) => f.path)).toEqual([
      'Sub/Deep/tiny.Txt',
      'Sub/mixed.bin',
      'ZERO.DAT',
      'a.mkf',
      'empty',
    ]);
  });

  it('records size, lower-case extension and head bytes', async () => {
    const { files } = await scanDir(root);
    const byPath = new Map(files.map((f) => [f.path, f]));

    expect(byPath.get('Sub/Deep/tiny.Txt')).toMatchObject({
      size: 4,
      ext: 'txt',
      headHex: '52494646',
      headAscii: 'RIFF',
    });
    expect(byPath.get('a.mkf')).toMatchObject({
      ext: 'mkf',
      headHex: '000102030405060708090a0b0c0d0e0f',
      headAscii: '................',
    });
    expect(byPath.get('empty')).toMatchObject({
      size: 0,
      ext: '',
      headHex: '',
      entropy: 0,
      blockEntropyMin: null,
      blockEntropyMax: null,
    });
  });

  it('reports whole-file and 64 KB block entropy', async () => {
    const { files } = await scanDir(root);
    const zero = files.find((f) => f.path === 'ZERO.DAT');
    const mixed = files.find((f) => f.path === 'Sub/mixed.bin');

    expect(zero).toMatchObject({ entropy: 0, blockEntropyMin: 0, blockEntropyMax: 0 });
    expect(mixed?.blockEntropyMin).toBe(0);
    expect(mixed?.blockEntropyMax).toBeCloseTo(8, 3);
    // Half zeros, half uniform: p(0) = (BLOCK + 256) / (2 * BLOCK), others 256 / (2 * BLOCK).
    const p0 = (BLOCK + 256) / (2 * BLOCK);
    const q = 256 / (2 * BLOCK);
    const expected = -(p0 * Math.log2(p0)) - 255 * q * Math.log2(q);
    expect(mixed?.entropy).toBeCloseTo(expected, 3);
  });

  it('does not modify the scanned files', async () => {
    const target = path.join(root, 'a.mkf');
    const before = await stat(target);
    const content = await readFile(target);
    await scanDir(root);
    const after = await stat(target);
    expect(after.mtimeMs).toBe(before.mtimeMs);
    expect(after.size).toBe(before.size);
    expect(await readFile(target)).toEqual(content);
  });

  it('skips symbolic links instead of following them', async () => {
    const link = path.join(root, 'link-out');
    try {
      await symlink(tmpdir(), link, 'junction');
    } catch {
      return; // Symlinks may need extra privileges on Windows; nothing to verify then.
    }
    try {
      const { files, skipped } = await scanDir(root);
      expect(files.some((f) => f.path.startsWith('link-out'))).toBe(false);
      expect(skipped).toContainEqual({ path: 'link-out', reason: 'symlink' });
    } finally {
      await rm(link, { force: true });
    }
  });
});
