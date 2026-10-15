import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { ExeTablesError } from '../exe-tables';
import { checkLunarTable } from '../lunar/check';
import type { CommandContext } from './inventory';

const EXE_NAME = 'rich4.exe';

/**
 * Compares the computed lunar calendar (what `pnpm -F extract lunar-gen` writes into
 * packages/shared) with the lunar table in rich4.exe. Prints counts only; writes nothing.
 */
export async function lunarCheck({ gameDir }: CommandContext): Promise<void> {
  const file = (await readdir(gameDir)).find((f) => f.toLowerCase() === EXE_NAME);
  if (!file) throw new ExeTablesError(`${EXE_NAME} not found in RICHMAN4_DIR`);
  const { entries, identical } = checkLunarTable(await readFile(path.join(gameDir, file)));
  const verdict = identical === entries ? 'all identical' : `${entries - identical} differ`;
  console.log(`lunar table: ${entries} days, ${identical} identical (${verdict})`);
  if (identical !== entries) process.exitCode = 1;
}
