// The Chinese lunisolar calendar from the rules in use since 1929 (China Standard Time, UTC+8):
// a month starts on the local date of a new moon; the month holding the December solstice is
// month 11; a period of 13 months between two month-11s gets one leap month, the first month in it
// that holds no principal solar term (中氣, solar longitude a multiple of 30°), numbered like the
// month before it.
import { dateOfJdn, julianDay, localJdn, newMoonJde, solarTermJde } from './astronomy';

export const CHINA_UTC_OFFSET = 8;

const SYNODIC_MONTH = 29.530588861;
/** JDE of new moon k = 0 (6 January 2000), the origin of the k numbering. */
const NEW_MOON_EPOCH = 2451550.09766;

export interface LunarMonth {
  /** Julian Day Number of the first day. */
  startJdn: number;
  /** 1-12. */
  number: number;
  leap: boolean;
}

export interface LunarYear {
  /** Julian Day Number of the first day of month 1. */
  newYearJdn: number;
  /** Day counts (29 or 30) of the months in order, a leap month in its place. */
  monthLengths: number[];
  /** Number of the month the leap month follows; 0 when the year has none. */
  leapMonth: number;
}

const localDate = (jde: number) => localJdn(jde, CHINA_UTC_OFFSET);

/** Local date of the December solstice of `year`. */
function decemberSolstice(year: number): number {
  return localDate(solarTermJde(270, julianDay(year, 12, 21)));
}

/** Local dates of the new moons from a little before `fromJdn` to a little after `toJdn`. */
function newMoonsBetween(fromJdn: number, toJdn: number): number[] {
  const first = Math.floor((fromJdn - NEW_MOON_EPOCH) / SYNODIC_MONTH) - 2;
  const last = Math.ceil((toJdn - NEW_MOON_EPOCH) / SYNODIC_MONTH) + 2;
  const dates: number[] = [];
  for (let k = first; k <= last; k++) dates.push(localDate(newMoonJde(k)));
  return dates;
}

/** The last new moon date on or before `jdn`. */
function newMoonOnOrBefore(newMoons: readonly number[], jdn: number): number {
  const found = newMoons.filter((d) => d <= jdn).at(-1);
  if (found === undefined) throw new Error(`no new moon before JDN ${jdn}`);
  return found;
}

/** Local dates of the principal terms from the December solstice of `year - 1` on, 14 of them. */
function principalTerms(year: number): number[] {
  const terms: number[] = [];
  let guess = julianDay(year - 1, 12, 21);
  for (let i = 0; i < 14; i++) {
    const jde = solarTermJde((270 + 30 * i) % 360, guess);
    terms.push(localDate(jde));
    guess = jde + 30.4;
  }
  return terms;
}

/** The months of the period from month 11 of `year - 1` up to month 11 of `year`. */
function monthsOfPeriod(year: number): LunarMonth[] {
  const start = decemberSolstice(year - 1);
  const end = decemberSolstice(year);
  const newMoons = newMoonsBetween(start, end);
  const first = newMoonOnOrBefore(newMoons, start);
  const next = newMoonOnOrBefore(newMoons, end);
  const starts = newMoons.filter((d) => d >= first && d < next);
  const bounds = [...starts, next];

  let leapIndex = -1;
  if (starts.length === 13) {
    const terms = principalTerms(year);
    leapIndex = starts.findIndex(
      (from, i) => !terms.some((t) => t >= from && t < (bounds[i + 1] ?? from)),
    );
  } else if (starts.length !== 12) {
    throw new Error(`${starts.length} months between the solstices of ${year - 1} and ${year}`);
  }

  const months: LunarMonth[] = [];
  let number = 10;
  starts.forEach((startJdn, i) => {
    const leap = i === leapIndex;
    if (!leap) number = (number % 12) + 1;
    months.push({ startJdn, number, leap });
  });
  return months;
}

/** Every month from month 11 of `firstYear - 1` up to (not including) month 11 of `lastYear`. */
export function lunarMonths(firstYear: number, lastYear: number): LunarMonth[] {
  const months: LunarMonth[] = [];
  for (let year = firstYear; year <= lastYear; year++) months.push(...monthsOfPeriod(year));
  return months;
}

/** The lunar years `firstYear`..`lastYear`, each named by the Gregorian year of its new year. */
export function lunarYears(firstYear: number, lastYear: number): LunarYear[] {
  // One more period on each side so the first and last years are complete.
  const months = lunarMonths(firstYear, lastYear + 2);
  const years: LunarYear[] = [];
  let current: LunarYear | null = null;
  for (let i = 0; i + 1 < months.length; i++) {
    const month = months[i]!;
    const length = months[i + 1]!.startJdn - month.startJdn;
    if (month.number === 1 && !month.leap) {
      if (current) years.push(current);
      current = { newYearJdn: month.startJdn, monthLengths: [], leapMonth: 0 };
    }
    if (!current) continue;
    current.monthLengths.push(length);
    if (month.leap) current.leapMonth = month.number;
  }
  return years.filter((y) => {
    const { year } = dateOfJdn(y.newYearJdn);
    return year >= firstYear && year <= lastYear;
  });
}
