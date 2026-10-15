// Lunar (Chinese calendar) dates for holiday rules (docs/GAME_RULES.md §2 "日曆"), looked up in the
// generated table lunar-data.ts. Like the original, a game day maps to the lunar date by its day
// number.
import { toSerial, type CalendarDate } from './calendar';
import { LUNAR_FIRST_NEW_YEAR, LUNAR_YEARS } from './lunar-data';

export interface LunarDate {
  /** 1-12; a leap month has the number of the month it follows. */
  month: number;
  /** 1-30. */
  day: number;
  leap: boolean;
}

const LEAP_SHIFT = 13;

const leapOf = (packed: number) => packed >> LEAP_SHIFT;
const monthCount = (packed: number) => (leapOf(packed) === 0 ? 12 : 13);
const monthDays = (packed: number, i: number) => ((packed >> i) & 1 ? 30 : 29);

/** Day number of the first day of each lunar year in the table, plus one past the last. */
const YEAR_STARTS: readonly number[] = LUNAR_YEARS.reduce<number[]>(
  (starts, packed) => {
    let days = 0;
    for (let i = 0; i < monthCount(packed); i++) days += monthDays(packed, i);
    starts.push((starts.at(-1) ?? 0) + days);
    return starts;
  },
  [LUNAR_FIRST_NEW_YEAR],
);

/**
 * The lunar date of a game day. Past the end of the table (lunar year 2199) it throws: no game gets
 * there (it would take some 69,000 days), so reaching it is an engine bug.
 */
export function lunarDate(date: CalendarDate): LunarDate {
  const serial = toSerial(date);
  const end = YEAR_STARTS.at(-1) ?? LUNAR_FIRST_NEW_YEAR;
  if (serial < LUNAR_FIRST_NEW_YEAR || serial >= end) {
    throw new Error(`day ${serial} is outside the lunar table`);
  }
  // The last year that starts on or before the day.
  let low = 0;
  let high = LUNAR_YEARS.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if ((YEAR_STARTS[mid] ?? Infinity) <= serial) low = mid;
    else high = mid - 1;
  }
  const packed = LUNAR_YEARS[low] ?? 0;
  const leap = leapOf(packed);
  let rest = serial - (YEAR_STARTS[low] ?? 0);
  for (let i = 0; i < monthCount(packed); i++) {
    const days = monthDays(packed, i);
    if (rest < days) {
      const isLeap = leap !== 0 && i === leap;
      const month = leap !== 0 && i >= leap ? i : i + 1;
      return { month, day: rest + 1, leap: isLeap };
    }
    rest -= days;
  }
  throw new Error(`day ${serial} is past its lunar year`);
}
