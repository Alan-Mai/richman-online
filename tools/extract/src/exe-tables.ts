// Reads the rule/animation data tables out of rich4.exe into local-assets/tables.json
// (docs/ASSET_FORMATS.md "rich4.exe 資料表", DECISIONS.md 2026-10-14 "執行檔內的資料表").
// Pure: the command in commands/tables.ts does the I/O. Error messages name the failed check
// but never print table contents.
import { codeReferencesRange, readPe, readVa, type PeImage } from './formats/pe';

// Bump when a field is renamed or changes meaning; packages/shared parseOriginalTables checks it.
export const TABLES_JSON_VERSION = 2;

const HOLIDAY_MAPS = 8;
const HOLIDAYS_PER_MAP = 24;

export class ExeTablesError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExeTablesError';
  }
}

/** Where one table lives: `count` records of `stride` bytes starting at virtual address `va`. */
export interface TableSpec {
  va: number;
  count: number;
  stride: number;
}

export type TableName =
  | 'frameTicks'
  | 'stepPixels'
  | 'diceAnimDelay'
  | 'items'
  | 'startingFunds'
  | 'dayLimit'
  | 'netWorthTargetMultiple'
  | 'characters'
  | 'holidays';

export type ExeLayout = Record<TableName, TableSpec>;

/**
 * Addresses in the local copy of rich4.exe. Counts and strides come from the reading code
 * (loop bounds, index scaling); see ASSET_FORMATS.md for the evidence of each.
 */
export const RICH4_LAYOUT: ExeLayout = {
  // Only speeds 0-2: the byte that speed 3 would read is the frame counter itself.
  frameTicks: { va: 0x0046cb20, count: 3, stride: 1 },
  stepPixels: { va: 0x004749d8, count: 4, stride: 1 },
  diceAnimDelay: { va: 0x00475264, count: 4, stride: 4 },
  // Item k (1-based, as in the player item slots) is record k - 1 here.
  items: { va: 0x0047fee0, count: 13, stride: 8 },
  startingFunds: { va: 0x0046cb94, count: 6, stride: 4 },
  dayLimit: { va: 0x0046cbe8, count: 6, stride: 4 },
  netWorthTargetMultiple: { va: 0x0046cc00, count: 6, stride: 4 },
  characters: { va: 0x0047e80c, count: 12, stride: 0x68 },
  // 24 entries per map, maps 0-7 one after another (map index × 0x120).
  holidays: { va: 0x0047ff4a, count: HOLIDAY_MAPS * HOLIDAYS_PER_MAP, stride: 12 },
};

export interface ExeTables {
  animation: {
    /** 20 ms timer ticks per logical frame for game speeds 0-2; speed 3 runs on every tick. */
    frameTicks: number[];
    /** Map pixels moved per logical frame, by vehicle. */
    stepPixels: { walk: number; motorbike: number; car: number; temporary: number };
    /** Raw dice animation delay value for game speeds 0-3. */
    diceAnimDelay: number[];
  };
  items: { id: number; unknownAt0: number; unknownAt1: number; stock: number; points: number }[];
  setupOptions: { startingFunds: number[]; dayLimit: number[]; netWorthTargetMultiple: number[] };
  /** `id` is the character template index (player +0x13). */
  characters: { id: number; cashPercent: number; loanPercent: number }[];
  /** Per map index, its 24 holiday entries, raw. */
  holidays: {
    flags: number;
    kind: number;
    month: number;
    dayOrNth: number;
    weekday: number;
    event: number[];
  }[][];
}

function records(bytes: Uint8Array, image: PeImage, name: TableName, spec: TableSpec): DataView[] {
  const size = spec.count * spec.stride;
  const data = readVa(bytes, image, spec.va, size);
  if (!data) throw new ExeTablesError(`${name}: not inside a file-backed section`);
  if (!codeReferencesRange(bytes, image, spec.va, spec.va + size)) {
    throw new ExeTablesError(`${name}: no absolute address in code points into the table`);
  }
  return Array.from(
    { length: spec.count },
    (_, i) => new DataView(data.buffer, data.byteOffset + i * spec.stride, spec.stride),
  );
}

function check(ok: boolean, message: string): void {
  if (!ok) throw new ExeTablesError(message);
}

/** Strict: throws ExeTablesError (or PeFormatError) unless every structural and rule check passes. */
export function extractTables(bytes: Uint8Array, layout: ExeLayout = RICH4_LAYOUT): ExeTables {
  const image = readPe(bytes);
  const read = (name: TableName) => records(bytes, image, name, layout[name]);
  const u8s = (name: TableName) => read(name).map((r) => r.getUint8(0));
  const i32s = (name: TableName) => read(name).map((r) => r.getInt32(0, true));

  const stepPixels = u8s('stepPixels');
  const [walk = 0, motorbike = 0, car = 0, temporary = 0] = stepPixels;
  const startingFunds = i32s('startingFunds');
  const dayLimit = i32s('dayLimit');
  const netWorthTargetMultiple = i32s('netWorthTargetMultiple');

  // Rule checks, each backed by GAME_RULES.md: the step frame count divides by the per-frame
  // distance; the price index divides by the starting funds; both win-condition option lists
  // start with "no limit" (0).
  stepPixels.forEach((v, i) => check(v > 0, `stepPixels: vehicle ${i} must be > 0`));
  startingFunds.forEach((v, i) => check(v > 0, `startingFunds: option ${i} must be > 0`));
  check(dayLimit[0] === 0, 'dayLimit: option 0 must be 0 (no limit)');
  check(netWorthTargetMultiple[0] === 0, 'netWorthTargetMultiple: option 0 must be 0 (no target)');

  return {
    animation: {
      frameTicks: u8s('frameTicks'),
      stepPixels: { walk, motorbike, car, temporary },
      diceAnimDelay: read('diceAnimDelay').map((r) => r.getUint32(0, true)),
    },
    items: read('items').map((r, i) => ({
      id: i + 1,
      unknownAt0: r.getUint8(0),
      unknownAt1: r.getUint8(1),
      stock: r.getUint8(6),
      points: r.getUint8(7),
    })),
    setupOptions: { startingFunds, dayLimit, netWorthTargetMultiple },
    characters: read('characters').map((r, i) => ({
      id: i,
      cashPercent: r.getUint8(0x19),
      loanPercent: r.getUint8(0x18),
    })),
    holidays: chunk(
      read('holidays').map((r) => ({
        flags: r.getUint8(0),
        kind: r.getUint8(1),
        month: r.getUint8(2),
        dayOrNth: r.getUint8(3),
        weekday: r.getUint8(4),
        event: Array.from({ length: 7 }, (_, i) => r.getUint8(5 + i)),
      })),
      HOLIDAYS_PER_MAP,
    ),
  };
}

function chunk<T>(items: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, i) =>
    items.slice(i * size, (i + 1) * size),
  );
}
