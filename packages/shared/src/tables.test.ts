import { describe, expect, it } from 'vitest';
import { ORIGINAL_TABLES_VERSION, parseOriginalTables, type OriginalTablesError } from './tables';

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
    characters: Array.from({ length: 12 }, (_, i) => ({ id: i, cashPercent: 30 + i })),
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
    });
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
        j.characters.push({ id: 12, cashPercent: 50 });
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
    expect(parseOriginalTables(json).ok).toBe(true);
  });
});
