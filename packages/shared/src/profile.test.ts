import { describe, expect, it } from 'vitest';
import {
  PROVISIONAL_COMPUTER_PROFILE,
  drawCharacters,
  isValidProfile,
  openingSplit,
  profilesFromTables,
} from './profile';
import type { OriginalTables } from './tables';

const profile = (cashPercent: number) => ({ cashPercent, loanPercent: 0 });

describe('PROVISIONAL_COMPUTER_PROFILE', () => {
  it('is half cash and borrows half of net worth (non-original)', () => {
    expect(PROVISIONAL_COMPUTER_PROFILE).toEqual({ cashPercent: 50, loanPercent: 50 });
    expect(isValidProfile(PROVISIONAL_COMPUTER_PROFILE)).toBe(true);
  });
});

describe('profilesFromTables', () => {
  it("takes each character's cash share, with the provisional borrowing share", () => {
    // Made-up values; only the characters are read.
    const tables = {
      characters: [
        { id: 0, cashPercent: 35 },
        { id: 1, cashPercent: 80 },
      ],
    } as unknown as OriginalTables;
    expect(profilesFromTables(tables)).toEqual([
      { cashPercent: 35, loanPercent: 50 },
      { cashPercent: 80, loanPercent: 50 },
    ]);
  });
});

describe('drawCharacters', () => {
  it('draws different characters, the same for the same seed', () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 50; seed++) {
      const drawn = drawCharacters(12, 3, seed);
      expect(drawn).toHaveLength(3);
      expect(new Set(drawn).size).toBe(3);
      for (const index of drawn) expect(index).toBeGreaterThanOrEqual(0);
      for (const index of drawn) expect(index).toBeLessThan(12);
      expect(drawCharacters(12, 3, seed)).toEqual(drawn);
      seen.add(drawn.join(','));
    }
    expect(seen.size).toBeGreaterThan(40);
  });

  it('can take every character, and none', () => {
    expect([...drawCharacters(4, 4, 7)].sort()).toEqual([0, 1, 2, 3]);
    expect(drawCharacters(4, 0, 7)).toEqual([]);
  });

  it('refuses to draw more characters than there are', () => {
    expect(() => drawCharacters(2, 3, 1)).toThrow(RangeError);
  });
});

describe('isValidProfile', () => {
  it('accepts whole percents 0..100', () => {
    expect(isValidProfile({ cashPercent: 0, loanPercent: 100 })).toBe(true);
    expect(isValidProfile({ cashPercent: 100, loanPercent: 0 })).toBe(true);
  });

  it('rejects anything else', () => {
    for (const bad of [
      { cashPercent: 101, loanPercent: 0 },
      { cashPercent: 0, loanPercent: -1 },
      { cashPercent: 1.5, loanPercent: 0 },
      { cashPercent: '50', loanPercent: 0 },
      { cashPercent: 50 },
      null,
      undefined,
      [50, 50],
    ]) {
      expect(isValidProfile(bad)).toBe(false);
    }
  });
});

describe('openingSplit', () => {
  it('keeps cashPercent of the funds as cash, rounded down, and deposits the rest', () => {
    expect(openingSplit(15, profile(30))).toEqual({ cash: 4, deposit: 11 });
    expect(openingSplit(40_000, profile(50))).toEqual({ cash: 20_000, deposit: 20_000 });
  });

  it('gives an odd remainder to the deposit, unlike the human split', () => {
    expect(openingSplit(40_001, profile(50))).toEqual({ cash: 20_000, deposit: 20_001 });
  });

  it('handles 0 and 100 percent', () => {
    expect(openingSplit(40_000, profile(0))).toEqual({ cash: 0, deposit: 40_000 });
    expect(openingSplit(40_000, profile(100))).toEqual({ cash: 40_000, deposit: 0 });
  });

  it('divides first and multiplies in double precision, as the original does', () => {
    // 100 × (29 ÷ 100) is 28.999999999999996 in double precision; the exact product would be 29.
    expect(openingSplit(29, profile(100))).toEqual({ cash: 28, deposit: 1 });
  });
});
