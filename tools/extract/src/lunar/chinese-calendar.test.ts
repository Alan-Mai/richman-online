// Expected dates are published calendar facts (Chinese New Year dates and leap months as printed in
// official almanacs), not data from the original game.
import { describe, expect, it } from 'vitest';
import { dateOfJdn } from './astronomy';
import { lunarMonths, lunarYears } from './chinese-calendar';

const years = lunarYears(1997, 2040);
const year = (y: number) => {
  const found = years.find((ly) => dateOfJdn(ly.newYearJdn).year === y);
  expect(found, `lunar year ${y}`).toBeDefined();
  return found!;
};

describe('lunarYears', () => {
  it('starts each year on the published Chinese New Year date', () => {
    const newYears: [number, number, number][] = [
      [1997, 2, 7],
      [1998, 1, 28],
      [2000, 2, 5],
      [2001, 1, 24],
      [2004, 1, 22],
      [2010, 2, 14],
      [2020, 1, 25],
      [2023, 1, 22],
      [2033, 1, 31],
      [2034, 2, 19],
    ];
    for (const [y, month, day] of newYears) {
      expect(dateOfJdn(year(y).newYearJdn), `${y}`).toEqual({ year: y, month, day });
    }
  });

  it('places the published leap months', () => {
    const leaps: [number, number][] = [
      [1998, 5],
      [2001, 4],
      [2004, 2],
      [2006, 7],
      [2009, 5],
      [2012, 4],
      [2014, 9],
      [2017, 6],
      [2020, 4],
      [2023, 2],
      [2025, 6],
      [2028, 5],
      [2031, 3],
      // The well-known 2033 case: the leap month follows month 11.
      [2033, 11],
    ];
    for (const [y, leap] of leaps) {
      expect(year(y).leapMonth, `${y}`).toBe(leap);
      expect(year(y).monthLengths, `${y}`).toHaveLength(13);
    }
    for (const y of [1999, 2000, 2002, 2010, 2021, 2022, 2024]) {
      expect(year(y).leapMonth, `${y}`).toBe(0);
      expect(year(y).monthLengths, `${y}`).toHaveLength(12);
    }
  });

  it('chains the years without gaps, in months of 29 or 30 days', () => {
    expect(years.length).toBe(2040 - 1997 + 1);
    for (let i = 0; i + 1 < years.length; i++) {
      const days = years[i]!.monthLengths.reduce((a, b) => a + b, 0);
      expect(years[i]!.newYearJdn + days).toBe(years[i + 1]!.newYearJdn);
      expect(years[i]!.monthLengths.every((n) => n === 29 || n === 30)).toBe(true);
    }
  });
});

describe('lunarMonths', () => {
  it('numbers months 11, 12, 1, ... with the leap month repeating the number before it', () => {
    const months = lunarMonths(2033, 2034);
    expect(months.map((m) => (m.leap ? `閏${m.number}` : `${m.number}`))).toEqual([
      '11',
      '12',
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
      '9',
      '10',
      '11',
      '閏11',
      '12',
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
      '9',
      '10',
    ]);
  });
});
