import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { openFileByteSource } from '../formats/byte-source';
import { readMkfIndex, readMkfPayload } from '../formats/mkf';
import { MapExportError, countMaps, exportMap, mapEntryIndices } from '../map-export';
import type { CommandContext } from './inventory';

/** Parses `map [n ...]`: no arguments means every map. */
export function parseMapArgs(args: string[], count: number): number[] {
  if (args.length === 0) return Array.from({ length: count }, (_, i) => i);
  return args.map((a) => {
    const n = /^\d+$/.test(a) ? Number(a) : NaN;
    if (!(n < count)) throw new MapExportError(`map "${a}" not found; expected 0-${count - 1}`);
    return n;
  });
}

/** Writes local-assets/maps/<n>/{background.png,map.json} and refreshes maps/index.json. */
export async function map({ gameDir, outDir, args }: CommandContext): Promise<void> {
  const mapsDir = path.join(outDir, 'maps');
  const src = openFileByteSource(path.join(gameDir, 'map.mkf'));
  try {
    const entries = readMkfIndex(src);
    const maps = parseMapArgs(args, countMaps(entries));
    const generatedAt = new Date().toISOString();
    for (const n of maps) {
      const { gnd, data } = mapEntryIndices(n);
      const { backgroundPng, json } = exportMap(
        n,
        readMkfPayload(src, entries[gnd]!),
        readMkfPayload(src, entries[data]!),
        generatedAt,
      );
      const dir = path.join(mapsDir, String(n));
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, 'background.png'), backgroundPng);
      await writeFile(path.join(dir, 'map.json'), JSON.stringify(json) + '\n');
      console.log(`wrote ${dir}`);
    }
  } finally {
    src.close();
  }

  // The viewer lists maps from this index, so it covers every map exported so far.
  const exported = (await readdir(mapsDir, { withFileTypes: true }))
    .filter((d) => d.isDirectory() && /^\d+$/.test(d.name))
    .map((d) => Number(d.name))
    .filter((n) => existsSync(path.join(mapsDir, String(n), 'map.json')))
    .sort((a, b) => a - b);
  await writeFile(path.join(mapsDir, 'index.json'), JSON.stringify({ maps: exported }) + '\n');
}
