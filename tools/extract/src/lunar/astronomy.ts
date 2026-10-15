// Low-precision solar and lunar positions for building the Chinese calendar table. Written for this
// project from the formulas published in Jean Meeus, "Astronomical Algorithms" (2nd ed., 1998):
// chapter 7 (Julian Day), 25 (solar coordinates, lower accuracy), 27 (iterating to a given solar
// longitude) and 49 (phases of the Moon); and the ΔT polynomials by Espenak & Meeus (NASA Five
// Millennium Canon of Solar Eclipses, 2006). No third-party code or data is used.

const RAD = Math.PI / 180;
const sin = (degrees: number) => Math.sin(degrees * RAD);

/** Julian Day of a Gregorian date; `day` may carry the time as a fraction (Meeus ch. 7). */
export function julianDay(year: number, month: number, day: number): number {
  let y = year;
  let m = month;
  if (m <= 2) {
    y -= 1;
    m += 12;
  }
  const a = Math.floor(y / 100);
  const b = 2 - a + Math.floor(a / 4);
  return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + day + b - 1524.5;
}

/** The Gregorian calendar date of a Julian Day Number (the day that starts at JDN - 0.5). */
export function dateOfJdn(jdn: number): { year: number; month: number; day: number } {
  const alpha = Math.floor((jdn - 1867216.25) / 36524.25);
  const a = jdn + 1 + alpha - Math.floor(alpha / 4);
  const b = a + 1524;
  const c = Math.floor((b - 122.1) / 365.25);
  const d = Math.floor(365.25 * c);
  const e = Math.floor((b - d) / 30.6001);
  const day = b - d - Math.floor(30.6001 * e);
  const month = e < 14 ? e - 1 : e - 13;
  const year = month > 2 ? c - 4716 : c - 4715;
  return { year, month, day };
}

/** ΔT = TT - UT in seconds for a decimal year (Espenak & Meeus). */
export function deltaT(decimalYear: number): number {
  const y = decimalYear;
  if (y < 1986) {
    const t = y - 1975;
    return 45.45 + 1.067 * t - t ** 2 / 260 - t ** 3 / 718;
  }
  if (y < 2005) {
    const t = y - 2000;
    return (
      63.86 +
      0.3345 * t -
      0.060374 * t ** 2 +
      0.0017275 * t ** 3 +
      0.000651814 * t ** 4 +
      0.00002373599 * t ** 5
    );
  }
  if (y < 2050) {
    const t = y - 2000;
    return 62.92 + 0.32217 * t + 0.005589 * t ** 2;
  }
  const u = (y - 1820) / 100;
  if (y < 2150) {
    return -20 + 32 * u ** 2 - 0.5628 * (2150 - y);
  }
  return -20 + 32 * u ** 2;
}

function normalize(degrees: number): number {
  return ((degrees % 360) + 360) % 360;
}

/** The Sun's apparent geocentric longitude in degrees [0, 360) at Julian Ephemeris Day jde. */
export function solarLongitude(jde: number): number {
  const t = (jde - 2451545) / 36525;
  const l0 = 280.46646 + 36000.76983 * t + 0.0003032 * t ** 2;
  const m = 357.52911 + 35999.05029 * t - 0.0001537 * t ** 2;
  const c =
    (1.914602 - 0.004817 * t - 0.000014 * t ** 2) * sin(m) +
    (0.019993 - 0.000101 * t) * sin(2 * m) +
    0.000289 * sin(3 * m);
  const omega = 125.04 - 1934.136 * t;
  return normalize(l0 + c - 0.00569 - 0.00478 * sin(omega));
}

/** The JDE (TT) when the Sun's apparent longitude is `degrees`, searched near `guessJde`. */
export function solarTermJde(degrees: number, guessJde: number): number {
  let jde = guessJde;
  for (let i = 0; i < 50; i++) {
    // Signed difference in (-180, 180]; the Sun moves about 360 / 365.25 degrees a day.
    const diff = ((degrees - solarLongitude(jde) + 540) % 360) - 180;
    const step = (diff * 365.2422) / 360;
    jde += step;
    if (Math.abs(step) < 1e-7) break;
  }
  return jde;
}

/** The JDE (TT) of new moon number k (k = 0 is the new moon of 6 January 2000; Meeus ch. 49). */
export function newMoonJde(k: number): number {
  const t = k / 1236.85;
  const jde =
    2451550.09766 +
    29.530588861 * k +
    0.00015437 * t ** 2 -
    0.00000015 * t ** 3 +
    0.00000000073 * t ** 4;
  const e = 1 - 0.002516 * t - 0.0000074 * t ** 2;
  const m = 2.5534 + 29.1053567 * k - 0.0000014 * t ** 2 - 0.00000011 * t ** 3;
  const mp =
    201.5643 + 385.81693528 * k + 0.0107582 * t ** 2 + 0.00001238 * t ** 3 - 0.000000058 * t ** 4;
  const f =
    160.7108 + 390.67050284 * k - 0.0016118 * t ** 2 - 0.00000227 * t ** 3 + 0.000000011 * t ** 4;
  const omega = 124.7746 - 1.56375588 * k + 0.0020672 * t ** 2 + 0.00000215 * t ** 3;

  const correction =
    -0.4072 * sin(mp) +
    0.17241 * e * sin(m) +
    0.01608 * sin(2 * mp) +
    0.01039 * sin(2 * f) +
    0.00739 * e * sin(mp - m) -
    0.00514 * e * sin(mp + m) +
    0.00208 * e * e * sin(2 * m) -
    0.00111 * sin(mp - 2 * f) -
    0.00057 * sin(mp + 2 * f) +
    0.00056 * e * sin(2 * mp + m) -
    0.00042 * sin(3 * mp) +
    0.00042 * e * sin(m + 2 * f) +
    0.00038 * e * sin(m - 2 * f) -
    0.00024 * e * sin(2 * mp - m) -
    0.00017 * sin(omega) -
    0.00007 * sin(mp + 2 * m) +
    0.00004 * sin(2 * mp - 2 * f) +
    0.00004 * sin(3 * m) +
    0.00003 * sin(mp + m - 2 * f) +
    0.00003 * sin(2 * mp + 2 * f) -
    0.00003 * sin(mp + m + 2 * f) +
    0.00003 * sin(mp - m + 2 * f) -
    0.00002 * sin(mp - m - 2 * f) -
    0.00002 * sin(3 * mp + m) +
    0.00002 * sin(4 * mp);

  const planetary: readonly [number, number, number, number][] = [
    // [coefficient, A0, A per k, A per T^2]
    [0.000325, 299.77, 0.107408, -0.009173],
    [0.000165, 251.88, 0.016321, 0],
    [0.000164, 251.83, 26.651886, 0],
    [0.000126, 349.42, 36.412478, 0],
    [0.00011, 84.66, 18.206239, 0],
    [0.000062, 141.74, 53.303771, 0],
    [0.00006, 207.14, 2.453732, 0],
    [0.000056, 154.84, 7.30686, 0],
    [0.000047, 34.52, 27.261239, 0],
    [0.000042, 207.19, 0.121824, 0],
    [0.00004, 291.34, 1.844379, 0],
    [0.000037, 161.72, 24.198154, 0],
    [0.000035, 239.56, 25.513099, 0],
    [0.000023, 331.55, 3.592518, 0],
  ];
  const additional = planetary.reduce(
    (sum, [coef, a0, perK, perT2]) => sum + coef * sin(a0 + perK * k + perT2 * t ** 2),
    0,
  );
  return jde + correction + additional;
}

/** The decimal year of a Julian Day, accurate enough for ΔT. */
function decimalYear(jd: number): number {
  return 2000 + (jd - 2451545) / 365.25;
}

/** Converts a JDE (TT) to the Julian Day Number of the local date at UTC+offsetHours. */
export function localJdn(jde: number, offsetHours: number): number {
  const ut = jde - deltaT(decimalYear(jde)) / 86400;
  return Math.floor(ut + 0.5 + offsetHours / 24);
}
