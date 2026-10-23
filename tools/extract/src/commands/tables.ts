import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ExeTablesError, TABLES_JSON_VERSION, extractTables } from '../exe-tables';
import type { CommandContext } from './inventory';

const EXE_NAME = 'rich4.exe';

/** Writes local-assets/tables.json. Prints only table sizes, never their contents. */
export async function tables({ gameDir, outDir }: CommandContext): Promise<void> {
  const file = (await readdir(gameDir)).find((f) => f.toLowerCase() === EXE_NAME);
  if (!file) throw new ExeTablesError(`${EXE_NAME} not found in RICHMAN4_DIR`);
  const bytes = await readFile(path.join(gameDir, file));
  const t = extractTables(bytes);

  const json = {
    version: TABLES_JSON_VERSION,
    generatedAt: new Date().toISOString(),
    source: {
      file,
      size: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    },
    ...t,
  };
  await mkdir(outDir, { recursive: true });
  const outFile = path.join(outDir, 'tables.json');
  await writeFile(outFile, JSON.stringify(json, null, 2) + '\n');

  console.log(
    [
      `frameTicks ${t.animation.frameTicks.length}`,
      `stepPixels 4`,
      `diceAnimDelay ${t.animation.diceAnimDelay.length}`,
      `items ${t.items.length}`,
      `setup options ${t.setupOptions.startingFunds.length} × 3`,
      `day limit labels ${t.setupOptions.dayLimitLabels.length}`,
      `characters ${t.characters.length}`,
      `holidays ${t.holidays.length} × ${t.holidays[0]?.length ?? 0}`,
    ].join(', '),
  );
  console.log(`wrote ${outFile}`);
}
