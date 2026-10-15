// Reference values are the worked examples in Meeus, "Astronomical Algorithms", and published
// event times (public facts), not data from the original game.
import { describe, expect, it } from 'vitest';
import {
  dateOfJdn,
  deltaT,
  julianDay,
  localJdn,
  newMoonJde,
  solarLongitude,
  solarTermJde,
} from './astronomy';

describe('julianDay', () => {
  it('matches the worked examples', () => {
    expect(julianDay(1957, 10, 4.81)).toBeCloseTo(2436116.31, 6); // Meeus example 7.a
    expect(julianDay(2000, 1, 1.5)).toBe(2451545);
    expect(julianDay(1987, 1, 27)).toBe(2446822.5);
    expect(julianDay(1988, 6, 19.5)).toBe(2447332);
  });
});

describe('dateOfJdn', () => {
  it('inverts julianDay at noon', () => {
    expect(dateOfJdn(2451545)).toEqual({ year: 2000, month: 1, day: 1 });
    expect(dateOfJdn(2450815)).toEqual({ year: 1998, month: 1, day: 1 });
    expect(dateOfJdn(2488070)).toEqual({ year: 2100, month: 1, day: 1 });
    // 2100 is not a leap year in the Gregorian calendar.
    expect(dateOfJdn(julianDay(2100, 3, 1.5))).toEqual({ year: 2100, month: 3, day: 1 });
    expect(julianDay(2100, 3, 1.5) - julianDay(2100, 2, 28.5)).toBe(1);
  });
});

describe('deltaT', () => {
  it('follows the Espenak-Meeus polynomials', () => {
    expect(deltaT(2000)).toBeCloseTo(63.86, 2);
    expect(deltaT(2010)).toBeCloseTo(66.7, 1);
    expect(deltaT(2100)).toBeGreaterThan(150);
  });
});

describe('solarLongitude', () => {
  it('matches Meeus example 25.a to the method accuracy', () => {
    expect(Math.abs(solarLongitude(2448908.5) - 199.909)).toBeLessThan(0.005);
  });
});

describe('solarTermJde', () => {
  it('finds the December 2000 solstice (13:37 UT on the 21st) within minutes', () => {
    const jde = solarTermJde(270, 2451898.5);
    const ut = jde - deltaT(2000.97) / 86400;
    expect(Math.abs(ut - (2451899.5 + (13 + 37 / 60) / 24))).toBeLessThan(10 / 1440);
  });
});

describe('newMoonJde', () => {
  it('matches Meeus example 49.a (k = -283, February 1977)', () => {
    expect(newMoonJde(-283)).toBeCloseTo(2443192.65118, 4);
  });

  it('puts new moon 0 on 6 January 2000, 18:14 UT', () => {
    const ut = newMoonJde(0) - deltaT(2000) / 86400;
    expect(Math.abs(ut - (2451549.5 + (18 + 14 / 60) / 24))).toBeLessThan(2 / 1440);
  });
});

describe('localJdn', () => {
  it('takes the date in the given time zone', () => {
    // 18:14 UT on 6 January is 02:14 on the 7th at UTC+8.
    expect(localJdn(newMoonJde(0), 0)).toBe(2451550);
    expect(localJdn(newMoonJde(0), 8)).toBe(2451551);
  });
});
