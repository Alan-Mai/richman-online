import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { scanDir } from '../inventory/scan';
import { formatSummary, summarizeByExt } from '../inventory/summary';

export interface CommandContext {
  gameDir: string;
  /** Absolute path of <repo>/local-assets; the only place output may be written. */
  outDir: string;
}

export async function inventory({ gameDir, outDir }: CommandContext): Promise<void> {
  const { files, skipped } = await scanDir(gameDir);

  const report = {
    version: 1,
    generatedAt: new Date().toISOString(),
    fileCount: files.length,
    totalSize: files.reduce((a, f) => a + f.size, 0),
    files,
    skipped,
  };

  await mkdir(outDir, { recursive: true });
  const outFile = path.join(outDir, 'inventory.json');
  await writeFile(outFile, JSON.stringify(report, null, 2) + '\n');

  process.stdout.write(formatSummary(summarizeByExt(files)));
  if (skipped.length > 0) {
    console.log(`skipped ${skipped.length}: ${skipped.map((s) => s.path).join(', ')}`);
  }
  console.log(`wrote ${outFile}`);
}
