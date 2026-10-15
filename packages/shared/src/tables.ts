// Original-game data tables exported locally by `pnpm -F extract cli tables` (DECISIONS.md
// 2026-10-14). The engine never reads files: callers load the JSON, validate it here and merge
// what they need into RuleConfig / GameSetup. Values are kept raw (0 = no limit, timer ticks,
// percentages); conversion happens where they are used.

export const ORIGINAL_TABLES_VERSION = 1;

export interface OriginalItem {
  /** Item number, 1-based as in the player item slots. */
  id: number;
  /** Meaning not yet known; kept verbatim. */
  unknownAt0: number;
  /** Meaning not yet known; kept verbatim. */
  unknownAt1: number;
  /** Initial shop stock (only items 1-8 are stocked at game start). */
  stock: number;
  /** Shop price in points. */
  points: number;
}

export interface OriginalCharacter {
  /** Character template index. */
  id: number;
  /** Computer opening cash share and bank target cash ratio, in percent. */
  cashPercent: number;
}

export interface OriginalTables {
  animation: {
    /** 20 ms timer ticks per logical frame for game speeds 0-2; speed 3 runs on every tick. */
    frameTicks: number[];
    /** Map pixels moved per logical frame, by vehicle. */
    stepPixels: { walk: number; motorbike: number; car: number; temporary: number };
    /** Raw dice animation delay value for game speeds 0-3. */
    diceAnimDelay: number[];
  };
  items: OriginalItem[];
  setupOptions: { startingFunds: number[]; dayLimit: number[]; netWorthTargetMultiple: number[] };
  characters: OriginalCharacter[];
}

export type OriginalTablesError =
  | { kind: 'unsupportedVersion' }
  /** `path` uses dots and indices, e.g. `items.3.points`. */
  | { kind: 'missing'; path: string }
  | { kind: 'wrongType'; path: string }
  | { kind: 'wrongLength'; path: string; expected: number }
  | { kind: 'outOfRange'; path: string };

export type ParseOriginalTablesResult =
  { ok: true; tables: OriginalTables } | { ok: false; errors: OriginalTablesError[] };

/** Record counts fixed by the original program (see ASSET_FORMATS.md "rich4.exe 資料表"). */
export const ORIGINAL_TABLE_LENGTHS = {
  frameTicks: 3,
  diceAnimDelay: 4,
  items: 13,
  setupOptions: 6,
  characters: 12,
} as const;

const U8_MAX = 0xff;
const I32_MAX = 0x7fffffff;
const U32_MAX = 0xffffffff;

type Range = readonly [min: number, max: number];

const BYTE: Range = [0, U8_MAX];
// Divisors in the original rules (step frame count, price index) must be positive.
const POSITIVE_BYTE: Range = [1, U8_MAX];
const POSITIVE_I32: Range = [1, I32_MAX];
const NON_NEGATIVE_I32: Range = [0, I32_MAX];
const U32: Range = [0, U32_MAX];
const PERCENT: Range = [0, 100];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Collects errors while reading; each reader returns undefined when its value is unusable. */
class Reader {
  readonly errors: OriginalTablesError[] = [];

  private at(parent: Record<string, unknown>, key: string, path: string): unknown {
    if (!(key in parent)) {
      this.errors.push({ kind: 'missing', path });
      return undefined;
    }
    return parent[key];
  }

  record(
    parent: Record<string, unknown>,
    key: string,
    path: string,
  ): Record<string, unknown> | undefined {
    const value = this.at(parent, key, path);
    if (value === undefined) return undefined;
    if (!isRecord(value)) {
      this.errors.push({ kind: 'wrongType', path });
      return undefined;
    }
    return value;
  }

  integer(
    parent: Record<string, unknown>,
    key: string,
    path: string,
    range: Range,
  ): number | undefined {
    const value = this.at(parent, key, path);
    if (value === undefined) return undefined;
    return this.checkInteger(value, path, range);
  }

  checkInteger(value: unknown, path: string, [min, max]: Range): number | undefined {
    if (typeof value !== 'number' || !Number.isInteger(value)) {
      this.errors.push({ kind: 'wrongType', path });
      return undefined;
    }
    if (value < min || value > max) {
      this.errors.push({ kind: 'outOfRange', path });
      return undefined;
    }
    return value;
  }

  array<T>(
    parent: Record<string, unknown>,
    key: string,
    path: string,
    length: number,
    item: (value: unknown, path: string, index: number) => T | undefined,
  ): T[] | undefined {
    const value = this.at(parent, key, path);
    if (value === undefined) return undefined;
    if (!Array.isArray(value)) {
      this.errors.push({ kind: 'wrongType', path });
      return undefined;
    }
    if (value.length !== length) {
      this.errors.push({ kind: 'wrongLength', path, expected: length });
      return undefined;
    }
    const out = value.map((v, i) => item(v, `${path}.${i}`, i));
    return out.every((v): v is T => v !== undefined) ? out : undefined;
  }

  integers(
    parent: Record<string, unknown>,
    key: string,
    path: string,
    length: number,
    range: Range,
  ) {
    return this.array(parent, key, path, length, (v, p) => this.checkInteger(v, p, range));
  }

  /** An object whose integer fields are listed in `fields`; `id` must equal `expectedId`. */
  entry<K extends string>(
    value: unknown,
    path: string,
    expectedId: number,
    fields: Record<K, Range>,
  ): ({ id: number } & Record<K, number>) | undefined {
    if (!isRecord(value)) {
      this.errors.push({ kind: 'wrongType', path });
      return undefined;
    }
    const id = this.integer(value, 'id', `${path}.id`, [expectedId, expectedId]);
    const out: Record<string, number | undefined> = { id };
    for (const key of Object.keys(fields) as K[]) {
      out[key] = this.integer(value, key, `${path}.${key}`, fields[key]);
    }
    return Object.values(out).every((v) => v !== undefined)
      ? (out as { id: number } & Record<K, number>)
      : undefined;
  }
}

/** Validates tables.json. Collects every error instead of stopping at the first; never throws. */
export function parseOriginalTables(json: unknown): ParseOriginalTablesResult {
  if (!isRecord(json)) return { ok: false, errors: [{ kind: 'wrongType', path: '' }] };
  if (json.version !== ORIGINAL_TABLES_VERSION) {
    return { ok: false, errors: [{ kind: 'unsupportedVersion' }] };
  }
  const r = new Reader();
  const L = ORIGINAL_TABLE_LENGTHS;

  const animation = r.record(json, 'animation', 'animation');
  const frameTicks =
    animation && r.integers(animation, 'frameTicks', 'animation.frameTicks', L.frameTicks, BYTE);
  const pixels = animation && r.record(animation, 'stepPixels', 'animation.stepPixels');
  const pixel = (key: string) =>
    pixels && r.integer(pixels, key, `animation.stepPixels.${key}`, POSITIVE_BYTE);
  const [walk, motorbike, car, temporary] = ['walk', 'motorbike', 'car', 'temporary'].map(pixel);
  const diceAnimDelay =
    animation &&
    r.integers(animation, 'diceAnimDelay', 'animation.diceAnimDelay', L.diceAnimDelay, U32);

  const items = r.array(json, 'items', 'items', L.items, (v, p, i) =>
    r.entry(v, p, i + 1, { unknownAt0: BYTE, unknownAt1: BYTE, stock: BYTE, points: BYTE }),
  );

  const setup = r.record(json, 'setupOptions', 'setupOptions');
  const option = (key: string, range: Range) =>
    setup && r.integers(setup, key, `setupOptions.${key}`, L.setupOptions, range);
  const startingFunds = option('startingFunds', POSITIVE_I32);
  const dayLimit = option('dayLimit', NON_NEGATIVE_I32);
  const netWorthTargetMultiple = option('netWorthTargetMultiple', NON_NEGATIVE_I32);

  const characters = r.array(json, 'characters', 'characters', L.characters, (v, p, i) =>
    r.entry(v, p, i, { cashPercent: PERCENT }),
  );

  if (
    r.errors.length > 0 ||
    !frameTicks ||
    walk === undefined ||
    motorbike === undefined ||
    car === undefined ||
    temporary === undefined ||
    !diceAnimDelay ||
    !items ||
    !startingFunds ||
    !dayLimit ||
    !netWorthTargetMultiple ||
    !characters
  ) {
    return { ok: false, errors: r.errors };
  }
  return {
    ok: true,
    tables: {
      animation: { frameTicks, stepPixels: { walk, motorbike, car, temporary }, diceAnimDelay },
      items,
      setupOptions: { startingFunds, dayLimit, netWorthTargetMultiple },
      characters,
    },
  };
}
