import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { computeLunarData, packLunarYear, renderLunarData } from './lunar-data';

describe('packLunarYear', () => {
  it('sets one bit per 30-day month', () => {
    const lengths = [30, 29, 30, 29, 29, 30, 29, 30, 29, 30, 30, 29];
    expect(packLunarYear({ newYearJdn: 0, monthLengths: lengths, leapMonth: 0 })).toBe(
      0b0_0110_1010_0101,
    );
  });

  it('keeps the leap month in bits 13-16', () => {
    const lengths = Array.from({ length: 13 }, () => 29);
    expect(packLunarYear({ newYearJdn: 0, monthLengths: lengths, leapMonth: 11 })).toBe(11 << 13);
  });
});

describe('renderLunarData', () => {
  it('writes the first year, its new year as a game day number and the packed years', () => {
    const source = renderLunarData([
      {
        newYearJdn: 2450815 - 328,
        monthLengths: Array.from({ length: 12 }, () => 30),
        leapMonth: 0,
      },
      {
        newYearJdn: 2450815 + 26,
        monthLengths: Array.from({ length: 13 }, () => 29),
        leapMonth: 5,
      },
    ]);
    expect(source).toContain('export const LUNAR_FIRST_YEAR = 1997;');
    expect(source).toContain('export const LUNAR_FIRST_NEW_YEAR = -328;');
    expect(source).toMatch(/LUNAR_YEARS: readonly number\[\] = \[\s*4095, 40960,\s*\];/);
  });
});

describe('packages/shared/src/lunar-data.ts', () => {
  it('is what the generator produces (run `pnpm -F extract lunar-gen` after changing it)', () => {
    const file = path.resolve(import.meta.dirname, '../../../../packages/shared/src/lunar-data.ts');
    expect(existsSync(file), file).toBe(true);
    expect(readFileSync(file, 'utf8').replace(/\r\n/g, '\n')).toBe(computeLunarData());
  });
});
