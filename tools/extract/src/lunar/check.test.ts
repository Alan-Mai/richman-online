import { describe, expect, it } from 'vitest';
import { ExeTablesError } from '../exe-tables';
import { buildFakePe } from '../formats/fake-pe';
import { checkLunarTable, type LunarTableSpec } from './check';
import { lunarMonths } from './chinese-calendar';
import { GAME_EPOCH_JDN } from './lunar-data';

const BASE = 0x400000;
const RVA = 0x2000;
const COUNT = 100;
const SPEC: LunarTableSpec = { va: BASE + RVA, count: COUNT };

/** A table built from the computed calendar itself, with made-up high words. */
function fakeTable(): Uint8Array {
  const months = lunarMonths(1998, 1999);
  const data = new Uint8Array(COUNT * 4);
  const view = new DataView(data.buffer);
  for (let s = 0; s < COUNT; s++) {
    const jdn = GAME_EPOCH_JDN + s;
    const month = months.filter((m) => m.startJdn <= jdn).at(-1)!;
    const low = (month.number << 8) | (jdn - month.startJdn + 1);
    view.setUint32(4 * s, (((s * 7) % 50) << 16) | low, true);
  }
  return data;
}

const pe = (data: Uint8Array) => buildFakePe(BASE, [{ name: '.data', rva: RVA, data }]);

describe('checkLunarTable', () => {
  it('counts every entry whose month and day match, ignoring the high word', () => {
    expect(checkLunarTable(pe(fakeTable()), SPEC)).toEqual({ entries: COUNT, identical: COUNT });
  });

  it('counts the entries that differ', () => {
    const data = fakeTable();
    data[4 * 10] = (data[4 * 10]! % 29) + 1; // a different day
    data[4 * 60 + 1] = (data[4 * 60 + 1]! % 12) + 1; // a different month
    expect(checkLunarTable(pe(data), SPEC)).toEqual({ entries: COUNT, identical: COUNT - 2 });
  });

  it('rejects a table the image does not hold', () => {
    expect(() => checkLunarTable(pe(new Uint8Array(16)), SPEC)).toThrow(ExeTablesError);
  });
});
