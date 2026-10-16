// Original-game data tables exported locally by `pnpm -F extract cli tables` (DECISIONS.md
// 2026-10-14). The engine never reads files: callers load the JSON, validate it here and merge
// what they need into RuleConfig / GameSetup. Values are kept raw (0 = no limit, timer ticks,
// percentages); conversion happens where they are used.

import type { HolidayDateRule, HolidayRule } from './holidays';

export const ORIGINAL_TABLES_VERSION = 2;

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
  /** Share of net worth a computer borrows at a bank, in percent. */
  loanPercent: number;
}

/**
 * One entry of a map's holiday table, raw (docs/ASSET_FORMATS.md "rich4.exe 資料表"). Convert with
 * originalHolidays.
 */
export interface OriginalHolidayEntry {
  /** Bit 0x80: left out of the lookup; any other value: a rest day. */
  flags: number;
  /** 0 Gregorian month and day, 1 lunar month and day, 2 nth weekday of the month. */
  kind: number;
  month: number;
  /** The day for kinds 0 and 1, n for kind 2. */
  dayOrNth: number;
  /** The weekday for kind 2 (0 = Sunday). */
  weekday: number;
  /** The event bytes (+5..+11); +5 is the event flag. Holiday events are not implemented. */
  event: number[];
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
  /** One table of 24 entries per original map, by map index. */
  holidays: OriginalHolidayEntry[][];
}

export type OriginalHolidaysResult =
  | { ok: true; holidays: HolidayRule[] }
  /** Indices of entries that may fall on a day but cannot be written as a HolidayRule. */
  | { ok: false; unsupported: number[] };

const HOLIDAY_DISABLED = 0x80;

/**
 * The date rule of an entry the original lookup can find, null for one it never finds (so leaving
 * it out changes nothing), or 'unsupported'. The original compares a month-and-day key: an
 * unknown kind compares against 0 and a date outside a month or a lunar month never matches; the
 * nth-weekday day is w − (weekday of the 1st) + 1 + 7(n − 1), with w replaced by 7 when below the
 * 1st's weekday, so n = 0 lands before the 1st and n ≥ 6 past day 31 unless w is 7 or more, which
 * HolidayRule cannot express (docs/GAME_RULES.md §2 "日曆").
 */
function holidayDate(e: OriginalHolidayEntry): HolidayDateRule | null | 'unsupported' {
  if ((e.flags & HOLIDAY_DISABLED) !== 0 || e.month < 1 || e.month > 12) return null;
  switch (e.kind) {
    case 0:
      return e.dayOrNth >= 1 && e.dayOrNth <= 31
        ? { kind: 'solar', month: e.month, day: e.dayOrNth }
        : null;
    case 1:
      return e.dayOrNth >= 1 && e.dayOrNth <= 30
        ? { kind: 'lunar', month: e.month, day: e.dayOrNth }
        : null;
    case 2:
      if (e.weekday >= 7) return e.dayOrNth <= 5 ? 'unsupported' : null;
      return e.dayOrNth >= 1 && e.dayOrNth <= 5
        ? { kind: 'nthWeekday', month: e.month, nth: e.dayOrNth, weekday: e.weekday }
        : null;
    default:
      return null;
  }
}

/**
 * A map's holiday table as HolidayRules, in order. Entries the original never finds (unused,
 * disabled, impossible dates) are left out, which gives the same answers; the rest are rest days
 * when their flags are not 0. Callers building an original-map Board use this; the engine does not.
 */
export function originalHolidays(entries: readonly OriginalHolidayEntry[]): OriginalHolidaysResult {
  const holidays: HolidayRule[] = [];
  const unsupported: number[] = [];
  entries.forEach((e, i) => {
    const date = holidayDate(e);
    if (date === 'unsupported') unsupported.push(i);
    else if (date) {
      holidays.push({ date, restDay: e.flags !== 0, disabled: false, event: e.event[0] ?? 0 });
    }
  });
  return unsupported.length > 0 ? { ok: false, unsupported } : { ok: true, holidays };
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
  holidayMaps: 8,
  holidaysPerMap: 24,
  holidayEventBytes: 7,
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
    r.entry(v, p, i, { cashPercent: PERCENT, loanPercent: PERCENT }),
  );

  const holidayEntry = (value: unknown, path: string): OriginalHolidayEntry | undefined => {
    if (!isRecord(value)) {
      r.errors.push({ kind: 'wrongType', path });
      return undefined;
    }
    const byte = (key: string) => r.integer(value, key, `${path}.${key}`, BYTE);
    const [flags, kind, month, dayOrNth, weekday] = [
      'flags',
      'kind',
      'month',
      'dayOrNth',
      'weekday',
    ].map(byte);
    const event = r.integers(value, 'event', `${path}.event`, L.holidayEventBytes, BYTE);
    return flags === undefined ||
      kind === undefined ||
      month === undefined ||
      dayOrNth === undefined ||
      weekday === undefined ||
      !event
      ? undefined
      : { flags, kind, month, dayOrNth, weekday, event };
  };
  const holidays = r.array(json, 'holidays', 'holidays', L.holidayMaps, (v, p) => {
    if (!Array.isArray(v)) {
      r.errors.push({ kind: 'wrongType', path: p });
      return undefined;
    }
    if (v.length !== L.holidaysPerMap) {
      r.errors.push({ kind: 'wrongLength', path: p, expected: L.holidaysPerMap });
      return undefined;
    }
    const out = v.map((e, i) => holidayEntry(e, `${p}.${i}`));
    return out.every((e): e is OriginalHolidayEntry => e !== undefined) ? out : undefined;
  });

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
    !characters ||
    !holidays
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
      holidays,
    },
  };
}
