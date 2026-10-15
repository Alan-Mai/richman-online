// Expected lunar dates are published calendar facts, not data from the original game.
import { describe, expect, it } from 'vitest';
import { nextDay, type CalendarDate } from './calendar';
import { lunarDate } from './lunar';

const date = (year: number, month: number, day: number): CalendarDate => ({ year, month, day });

describe('lunarDate', () => {
  it('gives the published lunar dates', () => {
    // Month 12 of lunar 1997 began on 30 December 1997.
    expect(lunarDate(date(1998, 1, 1))).toEqual({ month: 12, day: 3, leap: false });
    expect(lunarDate(date(1998, 1, 28))).toEqual({ month: 1, day: 1, leap: false });
    expect(lunarDate(date(2010, 2, 14))).toEqual({ month: 1, day: 1, leap: false });
    expect(lunarDate(date(2010, 2, 13))).toEqual({ month: 12, day: 30, leap: false });
  });

  it('marks leap months, numbered like the month before', () => {
    expect(lunarDate(date(1998, 6, 24))).toEqual({ month: 5, day: 1, leap: true });
    expect(lunarDate(date(2033, 12, 22))).toEqual({ month: 11, day: 1, leap: true });
    expect(lunarDate(date(2033, 12, 21))).toEqual({ month: 11, day: 30, leap: false });
  });

  it('runs day by day through the whole table without gaps', () => {
    let d = date(1998, 1, 1);
    let previous = lunarDate(d);
    for (let i = 0; i < 70_000; i++) {
      d = nextDay(d).date;
      const current = lunarDate(d);
      if (current.day === 1) {
        expect(previous.day === 29 || previous.day === 30, JSON.stringify(d)).toBe(true);
      } else {
        expect(current, JSON.stringify(d)).toEqual({ ...previous, day: previous.day + 1 });
      }
      previous = current;
    }
  });

  it('throws past the end of the table', () => {
    expect(() => lunarDate(date(2300, 1, 1))).toThrow(/lunar/);
  });
});
