// Writes packages/shared/src/lunar-data.ts: pnpm -F extract lunar-gen
// Needs no game files: the lunar calendar is computed by astronomy.ts and chinese-calendar.ts,
// written for this project from published formulas (DECISIONS.md 2026-10-15 "農曆").
//
// How the result was checked (2026-10-15):
// - Against rich4.exe's per-day lunar table, locally (`pnpm -F extract cli lunar-check`): every one
//   of its 8399 days (1998-01-01 to the end of 2020) is identical.
// - After 2020, against the Hong Kong Observatory's public Gregorian-Lunar conversion tables, day by
//   day for a sample of 16 years (2021, 2025, 2028, 2033, 2034, 2042, 2047, 2050, 2057, 2061, 2066,
//   2074, 2083, 2089, 2097, 2100; 5841 days, leap months included): all identical. The tables were
//   only read for the check, not stored. Years after 2100 have no official table to check against.
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { computeLunarData } from './lunar-data';

const out = path.resolve(import.meta.dirname, '../../../../packages/shared/src/lunar-data.ts');
writeFileSync(out, computeLunarData());
console.log(`wrote ${out}`);
