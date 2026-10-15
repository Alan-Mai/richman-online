// Compares the computed lunar calendar with the per-day lunar table in rich4.exe
// (docs/GAME_RULES.md §2 "日曆"). Reports counts only, never table contents.
import { ExeTablesError } from '../exe-tables';
import { readPe, readVa } from '../formats/pe';
import { dateOfJdn } from './astronomy';
import { lunarMonths } from './chinese-calendar';
import { GAME_EPOCH_JDN } from './lunar-data';

export interface LunarTableSpec {
  /** Virtual address of entry 0, which is game day 0 (1 January 1998). */
  va: number;
  /** One 32-bit entry per day; the low 16 bits are month << 8 | day. */
  count: number;
}

/**
 * Local copy of rich4.exe: the table read with the day number as index (notes.md step 10b). The
 * count runs up to the next address the program refers to.
 */
export const RICH4_LUNAR_TABLE: LunarTableSpec = { va: 0x0047639c, count: 8399 };

export interface LunarCheckResult {
  entries: number;
  identical: number;
}

export function checkLunarTable(
  bytes: Uint8Array,
  spec: LunarTableSpec = RICH4_LUNAR_TABLE,
): LunarCheckResult {
  const raw = readVa(bytes, readPe(bytes), spec.va, spec.count * 4);
  if (!raw) throw new ExeTablesError('lunar table: not inside one section');
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);

  const lastYear = dateOfJdn(GAME_EPOCH_JDN + spec.count).year;
  const months = lunarMonths(dateOfJdn(GAME_EPOCH_JDN).year, lastYear + 1);
  let identical = 0;
  let m = 0;
  for (let day = 0; day < spec.count; day++) {
    const jdn = GAME_EPOCH_JDN + day;
    while ((months[m + 1]?.startJdn ?? Infinity) <= jdn) m++;
    const month = months[m];
    if (month === undefined || month.startJdn > jdn) throw new Error(`no lunar month for ${jdn}`);
    const computed = (month.number << 8) | (jdn - month.startJdn + 1);
    if ((view.getUint32(4 * day, true) & 0xffff) === computed) identical++;
  }
  return { entries: spec.count, identical };
}
