import { describe, expect, it } from 'vitest';
import {
  CALENDAR_EPOCH,
  addDays,
  compareDates,
  daysBetween,
  daysInMonth,
  fromSerial,
  isLeapYear,
  isValidDate,
  nextDay,
  toSerial,
  weekday,
  type CalendarDate,
} from './calendar';

const date = (year: number, month: number, day: number): CalendarDate => ({ year, month, day });

describe('leap years', () => {
  it('are the years divisible by 4, with no century rule (like the original)', () => {
    expect(isLeapYear(2000)).toBe(true);
    expect(isLeapYear(2008)).toBe(true);
    expect(isLeapYear(2100)).toBe(true);
    expect(isLeapYear(1998)).toBe(false);
    expect(isLeapYear(2010)).toBe(false);
  });

  it('give February 29 days', () => {
    expect(daysInMonth(2008, 2)).toBe(29);
    expect(daysInMonth(2100, 2)).toBe(29);
    expect(daysInMonth(2010, 2)).toBe(28);
  });

  it('leave the other months as in the Gregorian calendar', () => {
    const lengths = Array.from({ length: 12 }, (_, i) => daysInMonth(2010, i + 1));
    expect(lengths).toEqual([31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]);
  });
});

describe('isValidDate', () => {
  it('accepts real dates from the epoch on', () => {
    expect(isValidDate(CALENDAR_EPOCH)).toBe(true);
    expect(isValidDate(date(2008, 2, 29))).toBe(true);
    expect(isValidDate(date(2100, 2, 29))).toBe(true);
    expect(isValidDate(date(2010, 12, 31))).toBe(true);
  });

  it('rejects days that do not exist, dates before the epoch and non-integers', () => {
    for (const bad of [
      date(2010, 2, 29),
      date(2010, 4, 31),
      date(2010, 13, 1),
      date(2010, 0, 1),
      date(2010, 1, 0),
      date(1997, 12, 31),
      date(2010.5, 1, 1),
      date(2010, 1, 1.5),
    ]) {
      expect(isValidDate(bad), JSON.stringify(bad)).toBe(false);
    }
  });
});

describe('day numbers', () => {
  it('count from 1 January 1998', () => {
    expect(toSerial(CALENDAR_EPOCH)).toBe(0);
    expect(toSerial(date(1998, 2, 1))).toBe(31);
    // 12 years, three of them leap (2000, 2004, 2008).
    expect(toSerial(date(2010, 1, 1))).toBe(12 * 365 + 3);
    expect(fromSerial(0)).toEqual(CALENDAR_EPOCH);
    expect(fromSerial(12 * 365 + 3)).toEqual(date(2010, 1, 1));
  });

  it('round-trip over two centuries', () => {
    let expected = CALENDAR_EPOCH;
    for (let serial = 0; serial < 80_000; serial++) {
      expect(fromSerial(serial)).toEqual(expected);
      expect(toSerial(expected)).toBe(serial);
      expected = nextDay(expected).date;
    }
  });
});

describe('weekday', () => {
  it('is (day number + 4) mod 7 with 0 for Sunday', () => {
    expect(weekday(CALENDAR_EPOCH)).toBe(4); // a Thursday
    expect(weekday(date(1998, 1, 4))).toBe(0);
    expect(weekday(date(2010, 1, 1))).toBe(5); // a Friday
    expect(weekday(date(2010, 1, 3))).toBe(0);
  });
});

describe('nextDay', () => {
  it('moves within a month', () => {
    expect(nextDay(date(2010, 1, 1))).toEqual({ date: date(2010, 1, 2), monthChanged: false });
    expect(nextDay(date(2008, 2, 28))).toEqual({ date: date(2008, 2, 29), monthChanged: false });
  });

  it('starts a new month and a new year', () => {
    expect(nextDay(date(2008, 2, 29))).toEqual({ date: date(2008, 3, 1), monthChanged: true });
    expect(nextDay(date(2010, 2, 28))).toEqual({ date: date(2010, 3, 1), monthChanged: true });
    expect(nextDay(date(2010, 4, 30))).toEqual({ date: date(2010, 5, 1), monthChanged: true });
    expect(nextDay(date(2010, 12, 31))).toEqual({ date: date(2011, 1, 1), monthChanged: true });
  });
});

describe('addDays and daysBetween', () => {
  it('add and count days across months and years', () => {
    expect(addDays(date(2010, 12, 1), 90)).toEqual(date(2011, 3, 1));
    expect(addDays(date(2008, 1, 1), 366)).toEqual(date(2009, 1, 1));
    expect(addDays(date(2010, 5, 5), 0)).toEqual(date(2010, 5, 5));
    expect(daysBetween(date(2010, 12, 1), date(2011, 3, 1))).toBe(90);
    expect(daysBetween(date(2011, 3, 1), date(2010, 12, 1))).toBe(-90);
  });
});

describe('compareDates', () => {
  it('orders by year, month, then day', () => {
    expect(compareDates(date(2010, 1, 1), date(2010, 1, 1))).toBe(0);
    expect(compareDates(date(2009, 12, 31), date(2010, 1, 1))).toBeLessThan(0);
    expect(compareDates(date(2010, 2, 1), date(2010, 1, 31))).toBeGreaterThan(0);
    expect(compareDates(date(2010, 1, 2), date(2010, 1, 1))).toBeGreaterThan(0);
  });
});
