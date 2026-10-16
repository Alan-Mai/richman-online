import { describe, expect, it } from 'vitest';
import { computerBorrowAmount, computerRepays, withInterest } from './loan';

describe('withInterest', () => {
  it('adds 10% rounded down, the same as floor(11 × deposit / 10) for 32-bit deposits', () => {
    const deposits = [0, 1, 9, 10, 99, 100, 12_345, 99_990, 2 ** 31 - 10, 2 ** 31 - 1];
    const mismatches = deposits.filter((d) => withInterest(d) !== Math.floor((11 * d) / 10));
    expect(mismatches).toEqual([]);
    expect(withInterest(12_345)).toBe(13_579);
  });
});

describe('computerBorrowAmount', () => {
  it('is loanPercent of net worth, rounded down', () => {
    expect(computerBorrowAmount(30, 41_000)).toBe(12_300);
    expect(computerBorrowAmount(1, 99)).toBe(0);
    expect(computerBorrowAmount(0, 1e6)).toBe(0);
  });
});

describe('computerRepays', () => {
  const today = { year: 2010, month: 1, day: 15 };
  const due = { year: 2010, month: 1, day: 21 };

  it('compares 1.1 times the loan as a double', () => {
    // 50 × 1.1 = 55.00000000000001 > 55 (10 × 1.1 happens to round to 11 exactly).
    expect(computerRepays({ cash: 55, deposit: 0, loan: 50, loanDue: due }, today)).toBe(false);
    expect(computerRepays({ cash: 56, deposit: 0, loan: 50, loanDue: due }, today)).toBe(true);
    expect(computerRepays({ cash: 11, deposit: 0, loan: 10, loanDue: due }, today)).toBe(true);
  });

  it('repays a loan past its due date too, when covered', () => {
    const past = { year: 2010, month: 1, day: 1 };
    expect(computerRepays({ cash: 12, deposit: 0, loan: 10, loanDue: past }, today)).toBe(true);
  });
});
