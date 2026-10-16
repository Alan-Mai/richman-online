import { ORIGINAL_TABLES_VERSION } from '@richman/shared';
import { describe, expect, it } from 'vitest';
import { readOriginalTables } from './original-tables';

/** Invented values only. */
function fakeTables() {
  return {
    version: ORIGINAL_TABLES_VERSION,
    animation: {
      frameTicks: [9, 7, 3],
      stepPixels: { walk: 5, motorbike: 6, car: 7, temporary: 5 },
      diceAnimDelay: [11, 12, 13, 0],
    },
    items: Array.from({ length: 13 }, (_, i) => ({
      id: i + 1,
      unknownAt0: 0,
      unknownAt1: 0,
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
      loanPercent: 40 - i,
    })),
    holidays: Array.from({ length: 8 }, () =>
      Array.from({ length: 24 }, () => ({
        flags: 0,
        kind: 0,
        month: 0,
        dayOrNth: 0,
        weekday: 0,
        event: [0, 0, 0, 0, 0, 0, 0],
      })),
    ),
  };
}

describe('readOriginalTables', () => {
  it('reads valid tables', () => {
    const result = readOriginalTables(JSON.stringify(fakeTables()));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.tables.animation.stepPixels.car).toBe(7);
  });

  it('says when the file is not JSON', () => {
    expect(readOriginalTables('{')).toEqual({ ok: false, problems: ['不是有效的 JSON 檔'] });
  });

  it('says when the version does not match', () => {
    const result = readOriginalTables(JSON.stringify({ ...fakeTables(), version: 999 }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems).toEqual([expect.stringContaining('版本不符')]);
  });

  it('names each field that is wrong', () => {
    const tables = fakeTables();
    const broken = {
      ...tables,
      animation: { ...tables.animation, frameTicks: [1, 2], stepPixels: { walk: 0 } },
    };
    const result = readOriginalTables(JSON.stringify(broken));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems).toContain('欄位 animation.frameTicks 不正確（應有 3 筆）');
    expect(result.problems).toContain('欄位 animation.stepPixels.walk 不正確（超出範圍）');
    expect(result.problems).toContain('欄位 animation.stepPixels.car 不正確（缺少）');
  });
});
