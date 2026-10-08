import type { InventoryEntry } from './scan';

export interface ExtSummary {
  ext: string;
  count: number;
  totalSize: number;
  minSize: number;
  maxSize: number;
  avgEntropy: number;
  /** Hex of the first 4 bytes when every file in the group starts with them, else null. */
  sharedHead4: string | null;
}

export function summarizeByExt(files: readonly InventoryEntry[]): ExtSummary[] {
  const groups = new Map<string, InventoryEntry[]>();
  for (const f of files) {
    const g = groups.get(f.ext);
    if (g) g.push(f);
    else groups.set(f.ext, [f]);
  }

  const rows = [...groups].map(([ext, g]): ExtSummary => {
    const sizes = g.map((f) => f.size);
    const head4 = g[0]?.headHex.slice(0, 8) ?? '';
    const shared = head4.length === 8 && g.every((f) => f.headHex.startsWith(head4));
    return {
      ext,
      count: g.length,
      totalSize: sizes.reduce((a, b) => a + b, 0),
      minSize: Math.min(...sizes),
      maxSize: Math.max(...sizes),
      avgEntropy: Math.round((g.reduce((a, f) => a + f.entropy, 0) / g.length) * 100) / 100,
      sharedHead4: shared ? head4 : null,
    };
  });

  return rows.sort((a, b) => b.count - a.count || (a.ext < b.ext ? -1 : a.ext > b.ext ? 1 : 0));
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function formatSummary(rows: readonly ExtSummary[]): string {
  const header = ['ext', 'files', 'total', 'min', 'max', 'avg H', 'shared head'];
  const body = rows.map((r) => [
    r.ext === '' ? '(none)' : r.ext,
    String(r.count),
    formatBytes(r.totalSize),
    formatBytes(r.minSize),
    formatBytes(r.maxSize),
    r.avgEntropy.toFixed(2),
    r.sharedHead4 ?? '-',
  ]);
  const total = rows.reduce((a, r) => a + r.totalSize, 0);
  const count = rows.reduce((a, r) => a + r.count, 0);
  const footer = ['TOTAL', String(count), formatBytes(total), '', '', '', ''];

  const table = [header, ...body, footer];
  const widths = header.map((_, i) => Math.max(...table.map((row) => row[i]?.length ?? 0)));
  const line = (row: string[]) =>
    row
      .map((cell, i) => (i === 0 ? cell.padEnd(widths[i] ?? 0) : cell.padStart(widths[i] ?? 0)))
      .join('  ')
      .trimEnd();
  const rule = widths.map((w) => '-'.repeat(w)).join('  ');

  return [line(header), rule, ...body.map(line), line(footer)].join('\n') + '\n';
}
