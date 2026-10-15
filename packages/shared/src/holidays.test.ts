// Holiday rules here are made up for the tests; real holiday tables come from the player's own
// tables.json.
import { describe, expect, it } from 'vitest';
import { validateBoard } from './board';
import { nextDay, weekday, type CalendarDate } from './calendar';
import { DEFAULT_RULE_CONFIG } from './config';
import {
  MAX_HOLIDAYS,
  holidayOn,
  isSundayOrHoliday,
  isValidHoliday,
  type HolidayDateRule,
  type HolidayRule,
} from './holidays';
import { lunarDate } from './lunar';
import { loopBoard } from './testing';

const date = (year: number, month: number, day: number): CalendarDate => ({ year, month, day });
const rule = (d: HolidayDateRule, patch: Partial<HolidayRule> = {}): HolidayRule => ({
  date: d,
  restDay: true,
  disabled: false,
  event: 0,
  ...patch,
});

/** Every date in `year` that a single-rule table matches. */
function matches(r: HolidayRule, year: number): CalendarDate[] {
  const out: CalendarDate[] = [];
  for (let d = date(year, 1, 1); d.year === year; d = nextDay(d).date) {
    if (holidayOn(d, [r]) !== null) out.push(d);
  }
  return out;
}

describe('holidayOn', () => {
  it('matches a fixed Gregorian date every year', () => {
    const r = rule({ kind: 'solar', month: 4, day: 1 });
    expect(matches(r, 2010)).toEqual([date(2010, 4, 1)]);
    expect(holidayOn(date(2011, 4, 1), [r])).toBe(r);
  });

  it('matches a lunar date, in a leap month of that number too', () => {
    const r = rule({ kind: 'lunar', month: 7, day: 15 });
    // 2006 has a leap month 7, so lunar 7/15 comes twice.
    const days = matches(r, 2006);
    expect(days.map((d) => lunarDate(d))).toEqual([
      { month: 7, day: 15, leap: false },
      { month: 7, day: 15, leap: true },
    ]);
    expect(matches(r, 2010)).toHaveLength(1);
  });

  it('matches the nth weekday when that weekday is not before the 1st', () => {
    // 1 September 2010 is a Wednesday: the first Thursday is the 2nd, the fifth the 30th.
    expect(weekday(date(2010, 9, 1))).toBe(3);
    const first = rule({ kind: 'nthWeekday', month: 9, nth: 1, weekday: 4 });
    expect(matches(first, 2010)).toEqual([date(2010, 9, 2)]);
    const fifth = rule({ kind: 'nthWeekday', month: 9, nth: 5, weekday: 4 });
    expect(matches(fifth, 2010)).toEqual([date(2010, 9, 30)]);
  });

  it("lands on the nth Sunday when the weekday comes before the 1st's (the original's way)", () => {
    // 1 May 2010 is a Saturday. The second Sunday is the 9th.
    expect(weekday(date(2010, 5, 1))).toBe(6);
    const sunday = rule({ kind: 'nthWeekday', month: 5, nth: 2, weekday: 0 });
    expect(matches(sunday, 2010)).toEqual([date(2010, 5, 9)]);
    // The second Monday would be the 10th, but the original's rule gives the second Sunday.
    const monday = rule({ kind: 'nthWeekday', month: 5, nth: 2, weekday: 1 });
    expect(matches(monday, 2010)).toEqual([date(2010, 5, 9)]);
  });

  it('never matches an nth weekday past the end of the month', () => {
    // 1 February 2010 is a Monday; a fifth Monday would be the 29th.
    expect(weekday(date(2010, 2, 1))).toBe(1);
    const r = rule({ kind: 'nthWeekday', month: 2, nth: 5, weekday: 1 });
    expect(matches(r, 2010)).toEqual([]);
  });

  it('takes the first rule that is not disabled', () => {
    const day = { kind: 'solar', month: 6, day: 6 } as const;
    const off = rule(day, { disabled: true });
    const workday = rule(day, { restDay: false });
    const rest = rule(day);
    expect(holidayOn(date(2010, 6, 6), [off, workday, rest])).toBe(workday);
    expect(holidayOn(date(2010, 6, 6), [off])).toBeNull();
  });
});

describe('isSundayOrHoliday', () => {
  it('is true on Sundays, whatever the table says', () => {
    expect(weekday(date(2010, 1, 3))).toBe(0);
    expect(isSundayOrHoliday(date(2010, 1, 3), [])).toBe(true);
  });

  it('is true on a rest day of the first matching rule only', () => {
    const day = { kind: 'solar', month: 6, day: 8 } as const; // a Tuesday
    expect(weekday(date(2010, 6, 8))).toBe(2);
    expect(isSundayOrHoliday(date(2010, 6, 8), [])).toBe(false);
    expect(isSundayOrHoliday(date(2010, 6, 8), [rule(day)])).toBe(true);
    expect(isSundayOrHoliday(date(2010, 6, 8), [rule(day, { restDay: false }), rule(day)])).toBe(
      false,
    );
    expect(isSundayOrHoliday(date(2010, 6, 8), [rule(day, { disabled: true })])).toBe(false);
  });
});

describe('isValidHoliday', () => {
  it('accepts rules in range', () => {
    expect(isValidHoliday(rule({ kind: 'solar', month: 12, day: 31 }))).toBe(true);
    expect(isValidHoliday(rule({ kind: 'lunar', month: 1, day: 30 }))).toBe(true);
    expect(isValidHoliday(rule({ kind: 'nthWeekday', month: 1, nth: 5, weekday: 6 }))).toBe(true);
  });

  it('rejects out-of-range fields', () => {
    const bad: HolidayRule[] = [
      rule({ kind: 'solar', month: 0, day: 1 }),
      rule({ kind: 'solar', month: 13, day: 1 }),
      rule({ kind: 'solar', month: 1, day: 32 }),
      rule({ kind: 'lunar', month: 1, day: 31 }),
      rule({ kind: 'lunar', month: 1, day: 0 }),
      rule({ kind: 'nthWeekday', month: 1, nth: 0, weekday: 0 }),
      rule({ kind: 'nthWeekday', month: 1, nth: 6, weekday: 0 }),
      rule({ kind: 'nthWeekday', month: 1, nth: 1, weekday: 7 }),
      rule({ kind: 'solar', month: 1, day: 1.5 }),
      rule({ kind: 'solar', month: 1, day: 1 }, { event: -1 }),
    ];
    for (const r of bad) expect(isValidHoliday(r), JSON.stringify(r)).toBe(false);
  });
});

describe('validateBoard and holidays', () => {
  const board = loopBoard([null, null, null, null, null, null]);
  const ok = rule({ kind: 'solar', month: 1, day: 1 });

  it('accepts a board with up to MAX_HOLIDAYS rules', () => {
    expect(validateBoard({ ...board, holidays: [] }, DEFAULT_RULE_CONFIG)).toEqual([]);
    const full = Array.from({ length: MAX_HOLIDAYS }, () => ok);
    expect(validateBoard({ ...board, holidays: full }, DEFAULT_RULE_CONFIG)).toEqual([]);
  });

  it('rejects too many rules and invalid ones', () => {
    const many = Array.from({ length: MAX_HOLIDAYS + 1 }, () => ok);
    expect(validateBoard({ ...board, holidays: many }, DEFAULT_RULE_CONFIG)).toContainEqual({
      reason: 'tooManyHolidays',
      count: MAX_HOLIDAYS + 1,
    });
    const bad = rule({ kind: 'lunar', month: 13, day: 1 });
    expect(validateBoard({ ...board, holidays: [ok, bad] }, DEFAULT_RULE_CONFIG)).toContainEqual({
      reason: 'invalidHoliday',
      holiday: 1,
    });
  });
});
