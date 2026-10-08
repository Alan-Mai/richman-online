import { createReadStream } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { EntropyAccumulator } from './entropy';

export const BLOCK_SIZE = 64 * 1024;

export interface InventoryEntry {
  /** Relative to the scanned root, always '/'-separated. */
  path: string;
  size: number;
  /** Lower-case, without the dot; '' when there is none. */
  ext: string;
  headHex: string;
  headAscii: string;
  entropy: number;
  blockEntropyMin: number | null;
  blockEntropyMax: number | null;
}

export interface SkippedEntry {
  path: string;
  reason: 'symlink' | 'not-a-file';
}

export interface ScanResult {
  files: InventoryEntry[];
  skipped: SkippedEntry[];
}

const round = (n: number) => Math.round(n * 10000) / 10000;
const roundOrNull = (n: number | null) => (n === null ? null : round(n));

function toAscii(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => (b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : '.')).join('');
}

// Plain code-unit order, so output does not depend on the machine's locale.
const byPath = (a: { path: string }, b: { path: string }) =>
  a.path < b.path ? -1 : a.path > b.path ? 1 : 0;

async function analyzeFile(absPath: string): Promise<Omit<InventoryEntry, 'path' | 'ext'>> {
  const acc = new EntropyAccumulator(BLOCK_SIZE);
  // Read-only: the original game directory must never be modified.
  for await (const chunk of createReadStream(absPath, { flags: 'r', highWaterMark: BLOCK_SIZE })) {
    acc.push(chunk as Buffer);
  }
  const r = acc.result();
  return {
    size: r.size,
    headHex: Buffer.from(r.head).toString('hex'),
    headAscii: toAscii(r.head),
    entropy: round(r.entropy),
    blockEntropyMin: roundOrNull(r.blockEntropyMin),
    blockEntropyMax: roundOrNull(r.blockEntropyMax),
  };
}

/** Recursively inventory every regular file under root. Symlinks are skipped, not followed. */
export async function scanDir(root: string): Promise<ScanResult> {
  const files: InventoryEntry[] = [];
  const skipped: SkippedEntry[] = [];

  async function walk(rel: string): Promise<void> {
    const entries = await readdir(path.join(root, rel), { withFileTypes: true });
    for (const d of entries) {
      const relPath = rel === '' ? d.name : `${rel}/${d.name}`;
      if (d.isSymbolicLink()) {
        skipped.push({ path: relPath, reason: 'symlink' });
      } else if (d.isDirectory()) {
        await walk(relPath);
      } else if (d.isFile()) {
        const ext = path.extname(d.name).slice(1).toLowerCase();
        files.push({ path: relPath, ext, ...(await analyzeFile(path.join(root, relPath))) });
      } else {
        skipped.push({ path: relPath, reason: 'not-a-file' });
      }
    }
  }

  await walk('');
  return { files: files.sort(byPath), skipped: skipped.sort(byPath) };
}
