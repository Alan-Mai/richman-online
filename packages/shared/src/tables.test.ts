import { describe, expect, it } from 'vitest';
import {
  ORIGINAL_TABLES_VERSION,
  originalHolidays,
  parseOriginalTables,
  type OriginalHolidayEntry,
  type OriginalTablesError,
} from './tables';

/** An unused holiday entry: all twelve bytes 0. */
function emptyHoliday(): OriginalHolidayEntry {
  return { flags: 0, kind: 0, month: 0, dayOrNth: 0, weekday: 0, event: [0, 0, 0, 0, 0, 0, 0] };
}

// Invented values only.
function validJson() {
  return {
    version: ORIGINAL_TABLES_VERSION,
    generatedAt: '2000-01-01T00:00:00.000Z',
    source: { file: 'fake.exe', size: 1, sha256: '00' },
    animation: {
      frameTicks: [9, 7, 3],
      stepPixels: { walk: 5, motorbike: 6, car: 7, temporary: 5 },
      diceAnimDelay: [11, 12, 13, 0],
    },
    items: Array.from({ length: 13 }, (_, i) => ({
      id: i + 1,
      unknownAt0: i % 3,
      unknownAt1: i % 4,
      stock: i,
      points: 20 + i,
    })),
    setupOptions: {
      startingFunds: [111, 222, 333, 444, 555, 666],
      dayLimit: [0, 31, 62, 93, 124, 155],
      netWorthTargetMultiple: [0, 7, 6, 5, 4, 3],
    },
    characters: Array.from({ length: 12 }, (_, i) => ({
      id: i,
      cashPercent: 30 + i,
      loanPercent: 60 - i,
    })),
    holidays: Array.from({ length: 8 }, (_, map) =>
      Array.from({ length: 24 }, (_, i) =>
        i === 0
          ? {
              flags: 1,
              kind: 0,
              month: map + 1,
              dayOrNth: 9,
              weekday: 0,
              event: [3, 1, 2, 0, 0, 0, 0],
            }
          : emptyHoliday(),
      ),
    ),
  };
}

type Doc = ReturnType<typeof validJson>;

/** Writes a value of the wrong type into a typed document. */
function put(target: object, key: string | number, value: unknown): void {
  (target as Record<string | number, unknown>)[key] = value;
}

function errorsOf(json: unknown): OriginalTablesError[] {
  const result = parseOriginalTables(json);
  expect(result.ok).toBe(false);
  return result.ok ? [] : result.errors;
}

/** Applies `edit` to a fresh valid document and returns the errors. */
function errorsAfter(edit: (json: Doc) => void): OriginalTablesError[] {
  const json = validJson();
  edit(json);
  return errorsOf(json);
}

describe('parseOriginalTables', () => {
  it('accepts valid tables and keeps only the table fields', () => {
    const json = validJson();
    const result = parseOriginalTables(json);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tables).toEqual({
      animation: json.animation,
      items: json.items,
      setupOptions: json.setupOptions,
      characters: json.characters,
      holidays: json.holidays,
    });
  });

  it('rejects version 1 files, which have no borrowing share or holidays', () => {
    expect(ORIGINAL_TABLES_VERSION).toBe(2);
    expect(errorsAfter((j) => (j.version = 1))).toEqual([{ kind: 'unsupportedVersion' }]);
  });

  it('checks the borrowing share and the holiday tables', () => {
    expect(
      errorsAfter((j) => {
        Reflect.deleteProperty(j.characters[0]!, 'loanPercent');
        j.characters[1]!.loanPercent = 101;
        j.holidays[0]!.pop();
        j.holidays[1]![2]!.flags = 256;
        j.holidays[2]![3]!.event.push(0);
        put(j.holidays[3]![4]!, 'weekday', '1');
        Reflect.deleteProperty(j.holidays[4]![5]!, 'kind');
      }),
    ).toEqual([
      { kind: 'missing', path: 'characters.0.loanPercent' },
      { kind: 'outOfRange', path: 'characters.1.loanPercent' },
      { kind: 'wrongLength', path: 'holidays.0', expected: 24 },
      { kind: 'outOfRange', path: 'holidays.1.2.flags' },
      { kind: 'wrongLength', path: 'holidays.2.3.event', expected: 7 },
      { kind: 'wrongType', path: 'holidays.3.4.weekday' },
      { kind: 'missing', path: 'holidays.4.5.kind' },
    ]);
    expect(errorsAfter((j) => j.holidays.pop())).toEqual([
      { kind: 'wrongLength', path: 'holidays', expected: 8 },
    ]);
  });

  it.each([null, 'tables', 42, [], undefined])('rejects a non-object document: %j', (json) => {
    expect(errorsOf(json)).toEqual([{ kind: 'wrongType', path: '' }]);
  });

  it('rejects another version without checking the rest', () => {
    expect(errorsAfter((j) => (j.version = ORIGINAL_TABLES_VERSION + 1))).toEqual([
      { kind: 'unsupportedVersion' },
    ]);
    expect(errorsOf({ animation: 1 })).toEqual([{ kind: 'unsupportedVersion' }]);
  });

  it('reports missing sections and fields', () => {
    expect(
      errorsAfter((j) => {
        Reflect.deleteProperty(j, 'characters');
        Reflect.deleteProperty(j.animation.stepPixels, 'car');
        Reflect.deleteProperty(j.items[2]!, 'points');
      }),
    ).toEqual([
      { kind: 'missing', path: 'animation.stepPixels.car' },
      { kind: 'missing', path: 'items.2.points' },
      { kind: 'missing', path: 'characters' },
    ]);
  });

  it('reports wrong types', () => {
    expect(
      errorsAfter((j) => {
        put(j.animation, 'frameTicks', 'fast');
        put(j.setupOptions.dayLimit, 3, '93');
        put(j.items, 0, 7);
        j.characters[1]!.cashPercent = 40.5;
      }),
    ).toEqual([
      { kind: 'wrongType', path: 'animation.frameTicks' },
      { kind: 'wrongType', path: 'items.0' },
      { kind: 'wrongType', path: 'setupOptions.dayLimit.3' },
      { kind: 'wrongType', path: 'characters.1.cashPercent' },
    ]);
  });

  it('reports wrong lengths', () => {
    expect(
      errorsAfter((j) => {
        j.animation.frameTicks.push(1);
        j.animation.diceAnimDelay.pop();
        j.items.pop();
        j.setupOptions.startingFunds.push(777);
        j.characters.push({ id: 12, cashPercent: 50, loanPercent: 50 });
      }),
    ).toEqual([
      { kind: 'wrongLength', path: 'animation.frameTicks', expected: 3 },
      { kind: 'wrongLength', path: 'animation.diceAnimDelay', expected: 4 },
      { kind: 'wrongLength', path: 'items', expected: 13 },
      { kind: 'wrongLength', path: 'setupOptions.startingFunds', expected: 6 },
      { kind: 'wrongLength', path: 'characters', expected: 12 },
    ]);
  });

  it('reports out-of-range values', () => {
    expect(
      errorsAfter((j) => {
        j.animation.frameTicks[0] = 256;
        j.animation.stepPixels.walk = 0;
        j.animation.diceAnimDelay[1] = -1;
        j.items[4]!.stock = 300;
        j.setupOptions.startingFunds[2] = 0;
        j.setupOptions.dayLimit[1] = -5;
        j.setupOptions.netWorthTargetMultiple[5] = 2 ** 31;
        j.characters[11]!.cashPercent = 101;
      }),
    ).toEqual([
      { kind: 'outOfRange', path: 'animation.frameTicks.0' },
      { kind: 'outOfRange', path: 'animation.stepPixels.walk' },
      { kind: 'outOfRange', path: 'animation.diceAnimDelay.1' },
      { kind: 'outOfRange', path: 'items.4.stock' },
      { kind: 'outOfRange', path: 'setupOptions.startingFunds.2' },
      { kind: 'outOfRange', path: 'setupOptions.dayLimit.1' },
      { kind: 'outOfRange', path: 'setupOptions.netWorthTargetMultiple.5' },
      { kind: 'outOfRange', path: 'characters.11.cashPercent' },
    ]);
  });

  it('requires ids to follow the record order', () => {
    expect(
      errorsAfter((j) => {
        j.items[0]!.id = 0;
        j.characters[3]!.id = 4;
      }),
    ).toEqual([
      { kind: 'outOfRange', path: 'items.0.id' },
      { kind: 'outOfRange', path: 'characters.3.id' },
    ]);
  });

  it('accepts the boundary values', () => {
    const json = validJson();
    json.animation.frameTicks = [0, 255, 0];
    json.animation.stepPixels.car = 255;
    json.animation.diceAnimDelay = [0, 2 ** 32 - 1, 0, 0];
    json.setupOptions.dayLimit = [0, 0, 2 ** 31 - 1, 1, 1, 1];
    json.characters[0]!.cashPercent = 0;
    json.characters[1]!.cashPercent = 100;
    json.characters[2]!.loanPercent = 0;
    json.characters[3]!.loanPercent = 100;
    json.holidays[7]![23] = {
      flags: 255,
      kind: 255,
      month: 255,
      dayOrNth: 255,
      weekday: 255,
      event: [255, 0, 255, 0, 255, 0, 255],
    };
    expect(parseOriginalTables(json).ok).toBe(true);
  });
});

describe('originalHolidays', () => {
  const entry = (
    flags: number,
    kind: number,
    month: number,
    dayOrNth: number,
    weekday = 0,
    eventFlag = 0,
  ): OriginalHolidayEntry => ({
    flags,
    kind,
    month,
    dayOrNth,
    weekday,
    event: [eventFlag, 9, 9, 9, 9, 9, 9],
  });

  it('turns entries into holiday rules, in order', () => {
    expect(
      originalHolidays([
        entry(1, 0, 3, 14, 0, 5),
        entry(0, 1, 8, 15),
        entry(2, 2, 5, 2, 0),
        emptyHoliday(),
      ]),
    ).toEqual({
      ok: true,
      holidays: [
        { date: { kind: 'solar', month: 3, day: 14 }, restDay: true, disabled: false, event: 5 },
        { date: { kind: 'lunar', month: 8, day: 15 }, restDay: false, disabled: false, event: 0 },
        {
          date: { kind: 'nthWeekday', month: 5, nth: 2, weekday: 0 },
          restDay: true,
          disabled: false,
          event: 0,
        },
      ],
    });
  });

  it('leaves out entries the original lookup can never find', () => {
    expect(
      originalHolidays([
        emptyHoliday(),
        entry(0x81, 0, 1, 1), // disabled
        entry(1, 3, 1, 1), // unknown kind: the original compares against 0
        entry(1, 0, 0, 5), // month 0
        entry(1, 1, 13, 5), // month 13
        entry(1, 0, 2, 0), // day 0
        entry(1, 0, 2, 32), // day 32
        entry(1, 1, 12, 31), // lunar months have at most 30 days
        entry(1, 2, 6, 0, 6), // the 0th weekday falls before the 1st
        entry(1, 2, 6, 6, 3), // the 6th weekday is past day 31
        entry(1, 0, 4, 1), // kept
      ]),
    ).toEqual({
      ok: true,
      holidays: [
        { date: { kind: 'solar', month: 4, day: 1 }, restDay: true, disabled: false, event: 0 },
      ],
    });
  });

  it('reports weekday rules that may fall on a day but are not representable', () => {
    // The original uses a weekday of 7 or more as is, which can land on a real day.
    expect(
      originalHolidays([entry(1, 2, 6, 1, 7), entry(1, 0, 4, 1), entry(1, 2, 6, 0, 9)]),
    ).toEqual({ ok: false, unsupported: [0, 2] });
  });
});
