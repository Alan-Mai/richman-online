// Reverse-engineering lookups in the local rich4.exe (read only; nothing is written). They print
// addresses and Windows API names only, never table contents.
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { ExeTablesError } from '../exe-tables';
import { findDword, readImports } from '../exe-search';
import { readPe } from '../formats/pe';
import type { CommandContext } from './inventory';

const EXE_NAME = 'rich4.exe';
const hex = (n: number) => `0x${n.toString(16).padStart(8, '0')}`;

async function readExe(gameDir: string): Promise<Uint8Array> {
  const file = (await readdir(gameDir)).find((f) => f.toLowerCase() === EXE_NAME);
  if (!file) throw new ExeTablesError(`${EXE_NAME} not found in RICHMAN4_DIR`);
  return new Uint8Array(await readFile(path.join(gameDir, file)));
}

/** Parses hex arguments ("0x4119e3" or "4119e3"); undefined when one is not a u32. */
function parseHexArgs(args: readonly string[]): number[] | undefined {
  const values = args.map((a) => (/^(0x)?[0-9a-f]{1,8}$/i.test(a) ? parseInt(a, 16) : NaN));
  return values.every((v) => Number.isInteger(v)) ? values : undefined;
}

/** `find-dword <hex> ...`: where each 32-bit value is stored, e.g. pointer tables to a function. */
export async function findDwordCommand({ gameDir, args }: CommandContext): Promise<void> {
  const values = parseHexArgs(args);
  if (!values || values.length === 0) {
    console.error('usage: pnpm -F extract cli find-dword <hex value> [...]');
    process.exitCode = 1;
    return;
  }
  const bytes = await readExe(gameDir);
  const image = readPe(bytes);
  for (const value of values) {
    const hits = findDword(bytes, image, value);
    if (hits.length === 0) console.log(`${hex(value)}: not found`);
    for (const { va, section } of hits) console.log(`${hex(value)} at ${hex(va)} (${section})`);
  }
}

/** `imports [hex slot address ...]`: imported Windows APIs and their address table slots. */
export async function importsCommand({ gameDir, args }: CommandContext): Promise<void> {
  const wanted = parseHexArgs(args);
  if (!wanted) {
    console.error('usage: pnpm -F extract cli imports [hex slot address ...]');
    process.exitCode = 1;
    return;
  }
  const bytes = await readExe(gameDir);
  const slots = readImports(bytes, readPe(bytes));
  const shown = wanted.length === 0 ? slots : slots.filter((s) => wanted.includes(s.va));
  for (const { va, dll, name } of shown) console.log(`${hex(va)} ${dll} ${name}`);
  for (const va of wanted) {
    if (!slots.some((s) => s.va === va)) console.log(`${hex(va)}: not an import slot`);
  }
}
