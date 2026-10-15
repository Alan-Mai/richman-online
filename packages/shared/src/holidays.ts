// A board's holiday table (docs/GAME_RULES.md §2 "日曆"): the original keeps one per map, of up to
// 24 rules. Only rest days matter to the rules so far (loan due dates move past them, §4); the
// event part is kept raw until holiday events are implemented.
import { daysInMonth, weekday, type CalendarDate } from './calendar';
import { lunarDate } from './lunar';

export const MAX_HOLIDAYS = 24;

export type HolidayDateRule =
  /** A fixed Gregorian month and day. */
  | { kind: 'solar'; month: number; day: number }
  /** A lunar month and day; it also falls in a leap month of that number, as in the original. */
  | { kind: 'lunar'; month: number; day: number }
  /**
   * The nth `weekday` (0 = Sunday) of `month`, computed the original's way: when `weekday` comes
   * before the weekday of the 1st, the rule lands on the nth Sunday instead.
   */
  | { kind: 'nthWeekday'; month: number; nth: number; weekday: number };

export interface HolidayRule {
  date: HolidayDateRule;
  /** A day off: loan due dates are moved past it. */
  restDay: boolean;
  /** Left out of matching altogether, as in the original. */
  disabled: boolean;
  /** The original's event flags, raw; holiday events are not implemented. */
  event: number;
}

/**
 * The day of the month an nth-weekday rule falls on in `year`, or null when that is past the end
 * of the month. The original replaces a weekday before the 1st's with 7 (instead of adding 7),
 * which makes it the nth Sunday; kept as is (docs/GAME_RULES.md §2).
 */
function nthWeekdayDay(year: number, rule: { month: number; nth: number; weekday: number }) {
  const first = weekday({ year, month: rule.month, day: 1 });
  const target = rule.weekday < first ? 7 : rule.weekday;
  const day = target - first + 1 + (rule.nth - 1) * 7;
  return day <= daysInMonth(year, rule.month) ? day : null;
}

function falls(rule: HolidayDateRule, date: CalendarDate): boolean {
  switch (rule.kind) {
    case 'solar':
      return rule.month === date.month && rule.day === date.day;
    case 'lunar': {
      const lunar = lunarDate(date);
      return rule.month === lunar.month && rule.day === lunar.day;
    }
    case 'nthWeekday':
      return rule.month === date.month && nthWeekdayDay(date.year, rule) === date.day;
  }
}

/** The first rule that is not disabled and falls on `date`, or null. */
export function holidayOn(
  date: CalendarDate,
  holidays: readonly HolidayRule[],
): HolidayRule | null {
  return holidays.find((h) => !h.disabled && falls(h.date, date)) ?? null;
}

/** A Sunday, or a rest day in the holiday table: what loan due dates are moved past (§4). */
export function isSundayOrHoliday(date: CalendarDate, holidays: readonly HolidayRule[]): boolean {
  return weekday(date) === 0 || holidayOn(date, holidays)?.restDay === true;
}

const inRange = (value: number, min: number, max: number) =>
  Number.isInteger(value) && value >= min && value <= max;

/** Whether a rule's fields are in range. */
export function isValidHoliday({ date, event }: HolidayRule): boolean {
  if (!Number.isSafeInteger(event) || event < 0 || !inRange(date.month, 1, 12)) {
    return false;
  }
  switch (date.kind) {
    case 'solar':
      return inRange(date.day, 1, 31);
    case 'lunar':
      return inRange(date.day, 1, 30);
    case 'nthWeekday':
      return inRange(date.nth, 1, 5) && inRange(date.weekday, 0, 6);
  }
}
