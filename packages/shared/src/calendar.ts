// The in-game calendar (docs/GAME_RULES.md §2 "日曆"): the Gregorian calendar simplified like the
// original's, where every year divisible by 4 is a leap year. Dates are counted as day numbers
// from 1 January 1998 (day 0), the original's epoch.

export interface CalendarDate {
  year: number;
  /** 1-12. */
  month: number;
  /** 1-based day of the month. */
  day: number;
}

/** Day number 0. */
export const CALENDAR_EPOCH: CalendarDate = { year: 1998, month: 1, day: 1 };

/** The range the original clamps its starting date to (docs/GAME_RULES.md §2). */
export const EARLIEST_START_DATE: CalendarDate = CALENDAR_EPOCH;
export const LATEST_START_DATE: CalendarDate = { year: 2010, month: 12, day: 31 };

const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

export function isLeapYear(year: number): boolean {
  return year % 4 === 0;
}

export function daysInMonth(year: number, month: number): number {
  return month === 2 && isLeapYear(year) ? 29 : (MONTH_DAYS[month - 1] ?? 0);
}

/** Integer fields, on or after the epoch, and a day that exists in that month. */
export function isValidDate({ year, month, day }: CalendarDate): boolean {
  return (
    Number.isSafeInteger(year) &&
    Number.isInteger(month) &&
    Number.isInteger(day) &&
    year >= CALENDAR_EPOCH.year &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysInMonth(year, month)
  );
}

/** Leap years in [epoch year, year). */
function leapYearsBefore(year: number): number {
  const multiplesOf4 = (y: number) => Math.floor(y / 4);
  return multiplesOf4(year - 1) - multiplesOf4(CALENDAR_EPOCH.year - 1);
}

function daysBeforeYear(year: number): number {
  return (year - CALENDAR_EPOCH.year) * 365 + leapYearsBefore(year);
}

/** Days since the epoch. The date must be valid; anything else is a caller bug. */
export function toSerial(date: CalendarDate): number {
  if (!isValidDate(date)) {
    throw new Error(`invalid date ${JSON.stringify(date)}`);
  }
  let days = daysBeforeYear(date.year);
  for (let month = 1; month < date.month; month++) {
    days += daysInMonth(date.year, month);
  }
  return days + date.day - 1;
}

/** The date `serial` days after the epoch; serial must be a non-negative integer. */
export function fromSerial(serial: number): CalendarDate {
  if (!Number.isSafeInteger(serial) || serial < 0) {
    throw new Error(`invalid day number ${serial}`);
  }
  // Every 4 years have the same length here (no century rule), so the year is close to this.
  let year = CALENDAR_EPOCH.year + Math.floor((serial * 4) / 1461);
  while (daysBeforeYear(year) > serial) year--;
  while (daysBeforeYear(year + 1) <= serial) year++;
  let rest = serial - daysBeforeYear(year);
  let month = 1;
  while (rest >= daysInMonth(year, month)) {
    rest -= daysInMonth(year, month);
    month++;
  }
  return { year, month, day: rest + 1 };
}

export function addDays(date: CalendarDate, days: number): CalendarDate {
  return fromSerial(toSerial(date) + days);
}

/** Days from `from` to `to`; negative when `to` is earlier. */
export function daysBetween(from: CalendarDate, to: CalendarDate): number {
  return toSerial(to) - toSerial(from);
}

/** 0 = Sunday ... 6 = Saturday. */
export function weekday(date: CalendarDate): number {
  return (toSerial(date) + 4) % 7;
}

/** The next day, and whether it starts a new month (which triggers the month start, §2 item 7). */
export function nextDay(date: CalendarDate): { date: CalendarDate; monthChanged: boolean } {
  const { year, month, day } = date;
  if (day < daysInMonth(year, month)) {
    return { date: { year, month, day: day + 1 }, monthChanged: false };
  }
  const next = month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
  return { date: { ...next, day: 1 }, monthChanged: true };
}

/** Negative, zero or positive as a is before, equal to or after b. */
export function compareDates(a: CalendarDate, b: CalendarDate): number {
  return a.year - b.year || a.month - b.month || a.day - b.day;
}
