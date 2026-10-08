import { describe, expect, it } from 'vitest';
import type { InventoryEntry } from './scan';
import { formatSummary, summarizeByExt } from './summary';

function entry(p: string, size: number, headHex: string, entropy: number): InventoryEntry {
  const dot = p.lastIndexOf('.');
  return {
    path: p,
    size,
    ext: dot === -1 ? '' : p.slice(dot + 1).toLowerCase(),
    headHex,
    headAscii: '',
    entropy,
    blockEntropyMin: null,
    blockEntropyMax: null,
  };
}

const files = [
  entry('a.mkf', 100, '0011223344', 6),
  entry('b.MKF', 300, '0011223399', 8),
  entry('c.mid', 50, '4d546864aa', 3),
  entry('d.mid', 70, '4d546864bb', 5),
  entry('e.mid', 10, '4d546864cc', 4),
  entry('README', 5, '', 0),
];

describe('summarizeByExt', () => {
  it('groups by extension, most files first', () => {
    const rows = summarizeByExt(files);
    expect(rows.map((r) => [r.ext, r.count])).toEqual([
      ['mid', 3],
      ['mkf', 2],
      ['', 1],
    ]);
  });

  it('aggregates sizes and entropy', () => {
    const mkf = summarizeByExt(files).find((r) => r.ext === 'mkf');
    expect(mkf).toMatchObject({ totalSize: 400, minSize: 100, maxSize: 300, avgEntropy: 7 });
  });

  it('reports the first 4 bytes only when shared by the whole group', () => {
    const rows = summarizeByExt(files);
    expect(rows.find((r) => r.ext === 'mid')?.sharedHead4).toBe('4d546864');
    expect(rows.find((r) => r.ext === 'mkf')?.sharedHead4).toBe('00112233');
    expect(rows.find((r) => r.ext === '')?.sharedHead4).toBeNull();
  });
});

describe('formatSummary', () => {
  it('renders one line per extension plus header and total', () => {
    const lines = formatSummary(summarizeByExt(files)).trimEnd().split('\n');
    expect(lines).toHaveLength(2 + 3 + 1);
    expect(lines.at(-1)).toContain('6');
  });
});
