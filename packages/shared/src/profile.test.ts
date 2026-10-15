import { describe, expect, it } from 'vitest';
import { PROVISIONAL_COMPUTER_PROFILE, isValidProfile, openingSplit } from './profile';

const profile = (cashPercent: number) => ({ cashPercent, loanPercent: 0 });

describe('PROVISIONAL_COMPUTER_PROFILE', () => {
  it('is half cash and borrows half of net worth (non-original)', () => {
    expect(PROVISIONAL_COMPUTER_PROFILE).toEqual({ cashPercent: 50, loanPercent: 50 });
    expect(isValidProfile(PROVISIONAL_COMPUTER_PROFILE)).toBe(true);
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
