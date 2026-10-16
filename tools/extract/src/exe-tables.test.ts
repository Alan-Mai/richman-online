import { describe, expect, it } from 'vitest';
import {
  ExeTablesError,
  RICH4_LAYOUT,
  extractTables,
  type ExeLayout,
  type TableName,
} from './exe-tables';
import { buildFakePe, fakeCodeReferencing } from './formats/fake-pe';
import { PeFormatError } from './formats/pe';

// All values below are invented for the tests.
const BASE = 0x400000;
const DATA_RVA = 0x2000;

const SMALL_LAYOUT: ExeLayout = {
  frameTicks: { va: BASE + DATA_RVA + 0x00, count: 3, stride: 1 },
  stepPixels: { va: BASE + DATA_RVA + 0x04, count: 4, stride: 1 },
  diceAnimDelay: { va: BASE + DATA_RVA + 0x08, count: 4, stride: 4 },
  startingFunds: { va: BASE + DATA_RVA + 0x18, count: 6, stride: 4 },
  dayLimit: { va: BASE + DATA_RVA + 0x30, count: 6, stride: 4 },
  netWorthTargetMultiple: { va: BASE + DATA_RVA + 0x48, count: 6, stride: 4 },
  items: { va: BASE + DATA_RVA + 0x60, count: 13, stride: 8 },
  characters: { va: BASE + DATA_RVA + 0xc8, count: 12, stride: 0x68 },
  holidays: { va: BASE + DATA_RVA + 0x600, count: 8 * 24, stride: 12 },
};

interface FakeTables {
  frameTicks: number[];
  stepPixels: number[];
  diceAnimDelay: number[];
  startingFunds: number[];
  dayLimit: number[];
  netWorthTargetMultiple: number[];
  items: { a0: number; a1: number; stock: number; points: number }[];
  cashPercent: number[];
  loanPercent: number[];
  /** 8 maps × 24 entries × 12 raw bytes. */
  holidays: number[][][];
}

function fakeTables(): FakeTables {
  return {
    frameTicks: [9, 7, 3],
    stepPixels: [5, 6, 7, 5],
    diceAnimDelay: [11, 12, 13, 0],
    startingFunds: [111, 222, 333, 444, 555, 666],
    dayLimit: [0, 31, 62, 93, 124, 155],
    netWorthTargetMultiple: [0, 7, 6, 5, 4, 3],
    items: Array.from({ length: 13 }, (_, i) => ({
      a0: i % 3,
      a1: i % 4,
      stock: i + 1,
      points: 20 + i,
    })),
    cashPercent: Array.from({ length: 12 }, (_, i) => 30 + i),
    loanPercent: Array.from({ length: 12 }, (_, i) => 70 - i),
    holidays: Array.from({ length: 8 }, (_, map) =>
      Array.from({ length: 24 }, (_, i) =>
        Array.from({ length: 12 }, (_, b) => (map * 24 + i + b * 7) % 256),
      ),
    ),
  };
}

interface BuildOptions {
  layout?: ExeLayout;
  /** Table names whose addresses are left out of the fake code section. */
  unreferenced?: TableName[];
  /** Reference this address instead of the table start (e.g. a field inside a record). */
  referenceAt?: Partial<Record<TableName, number>>;
  dataSize?: number;
}

function buildExe(t: FakeTables, opts: BuildOptions = {}): Uint8Array {
  const layout = opts.layout ?? SMALL_LAYOUT;
  const dataVa = BASE + DATA_RVA;
  const data = new Uint8Array(opts.dataSize ?? 0xf00);
  const view = new DataView(data.buffer);
  const at = (name: TableName, i: number) => layout[name].va - dataVa + i * layout[name].stride;
  t.frameTicks.forEach((v, i) => view.setUint8(at('frameTicks', i), v));
  t.stepPixels.forEach((v, i) => view.setUint8(at('stepPixels', i), v));
  t.diceAnimDelay.forEach((v, i) => view.setUint32(at('diceAnimDelay', i), v, true));
  t.startingFunds.forEach((v, i) => view.setInt32(at('startingFunds', i), v, true));
  t.dayLimit.forEach((v, i) => view.setInt32(at('dayLimit', i), v, true));
  t.netWorthTargetMultiple.forEach((v, i) =>
    view.setInt32(at('netWorthTargetMultiple', i), v, true),
  );
  t.items.forEach((v, i) => {
    const o = at('items', i);
    view.setUint8(o, v.a0);
    view.setUint8(o + 1, v.a1);
    view.setUint32(o + 2, 0xdeadbeef, true); // pointer field, not exported
    view.setUint8(o + 6, v.stock);
    view.setUint8(o + 7, v.points);
  });
  t.cashPercent.forEach((v, i) => view.setUint8(at('characters', i) + 0x19, v));
  t.loanPercent.forEach((v, i) => view.setUint8(at('characters', i) + 0x18, v));
  t.holidays.flat().forEach((bytes, i) => data.set(bytes, at('holidays', i)));

  const names = Object.keys(layout) as TableName[];
  const refs = names
    .filter((n) => !opts.unreferenced?.includes(n))
    .map((n) => opts.referenceAt?.[n] ?? layout[n].va);
  return buildFakePe(BASE, [
    { name: 'AUTO', rva: 0x1000, data: fakeCodeReferencing(refs), code: true, virtualSize: 0 },
    { name: 'DGROUP', rva: DATA_RVA, data, virtualSize: 0 },
  ]);
}

function expectTablesError(
  exe: Uint8Array,
  pattern: RegExp,
  layout: ExeLayout = SMALL_LAYOUT,
): void {
  let error: unknown;
  try {
    extractTables(exe, layout);
  } catch (e) {
    error = e;
  }
  expect(error).toBeInstanceOf(ExeTablesError);
  expect((error as Error).message).toMatch(pattern);
}

describe('extractTables', () => {
  it('reads every table from a synthetic exe', () => {
    const t = fakeTables();
    expect(extractTables(buildExe(t), SMALL_LAYOUT)).toEqual({
      animation: {
        frameTicks: [9, 7, 3],
        stepPixels: { walk: 5, motorbike: 6, car: 7, temporary: 5 },
        diceAnimDelay: [11, 12, 13, 0],
      },
      items: t.items.map((v, i) => ({
        id: i + 1,
        unknownAt0: v.a0,
        unknownAt1: v.a1,
        stock: v.stock,
        points: v.points,
      })),
      setupOptions: {
        startingFunds: t.startingFunds,
        dayLimit: t.dayLimit,
        netWorthTargetMultiple: t.netWorthTargetMultiple,
      },
      characters: t.cashPercent.map((cashPercent, id) => ({
        id,
        cashPercent,
        loanPercent: t.loanPercent[id],
      })),
      holidays: t.holidays.map((entries) =>
        entries.map((b) => ({
          flags: b[0],
          kind: b[1],
          month: b[2],
          dayOrNth: b[3],
          weekday: b[4],
          event: b.slice(5),
        })),
      ),
    });
  });

  it('reads the real layout from a sparse synthetic exe', () => {
    const lo = Math.min(...Object.values(RICH4_LAYOUT).map((s) => s.va));
    const hi = Math.max(...Object.values(RICH4_LAYOUT).map((s) => s.va + s.count * s.stride));
    expect(lo).toBeGreaterThanOrEqual(BASE + DATA_RVA);
    const exe = buildExe(fakeTables(), { layout: RICH4_LAYOUT, dataSize: hi - (BASE + DATA_RVA) });
    const t = extractTables(exe);
    expect(t.animation.frameTicks).toEqual([9, 7, 3]);
    expect(t.characters.map((c) => c.cashPercent)).toEqual(fakeTables().cashPercent);
  });

  it('accepts a code reference that points inside a table rather than at its start', () => {
    const exe = buildExe(fakeTables(), {
      referenceAt: { characters: SMALL_LAYOUT.characters.va + 5 * 0x68 + 0x19 },
    });
    expect(extractTables(exe, SMALL_LAYOUT).characters).toHaveLength(12);
  });

  it('rejects a table that no code refers to', () => {
    expectTablesError(
      buildExe(fakeTables(), { unreferenced: ['dayLimit'] }),
      /^dayLimit: no absolute address/,
    );
  });

  it('rejects a reference just past the end of a table', () => {
    const spec = SMALL_LAYOUT.stepPixels;
    const exe = buildExe(fakeTables(), { referenceAt: { stepPixels: spec.va + spec.count } });
    expectTablesError(exe, /^stepPixels: no absolute address/);
  });

  it('rejects a table outside the file-backed data', () => {
    const layout = {
      ...SMALL_LAYOUT,
      characters: { ...SMALL_LAYOUT.characters, va: BASE + 0x9000 },
    };
    expectTablesError(
      buildExe(fakeTables(), { layout: SMALL_LAYOUT }),
      /^characters: not inside/,
      layout,
    );
  });

  it('rejects a table that runs past the end of its section', () => {
    const exe = buildExe(fakeTables(), { dataSize: 0xf00 });
    const layout = {
      ...SMALL_LAYOUT,
      characters: { ...SMALL_LAYOUT.characters, va: BASE + DATA_RVA + 0xef0 },
    };
    expectTablesError(exe, /^characters: not inside/, layout);
  });

  it.each([
    ['stepPixels', (t: FakeTables) => (t.stepPixels[2] = 0), /^stepPixels: vehicle 2 must be > 0$/],
    [
      'startingFunds',
      (t: FakeTables) => (t.startingFunds[4] = 0),
      /^startingFunds: option 4 must be > 0$/,
    ],
    [
      'negative startingFunds',
      (t: FakeTables) => (t.startingFunds[0] = -5),
      /^startingFunds: option 0/,
    ],
    ['dayLimit', (t: FakeTables) => (t.dayLimit[0] = 1), /^dayLimit: option 0 must be 0/],
    [
      'target',
      (t: FakeTables) => (t.netWorthTargetMultiple[0] = 2),
      /^netWorthTargetMultiple: option 0/,
    ],
  ])('rejects a failed rule check: %s', (_, mutate, pattern) => {
    const t = fakeTables();
    mutate(t);
    expectTablesError(buildExe(t), pattern);
  });

  it('error messages never contain table values', () => {
    const t = fakeTables();
    t.dayLimit[0] = 987654;
    let message = '';
    try {
      extractTables(buildExe(t), SMALL_LAYOUT);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).not.toBe('');
    expect(message).not.toContain('987654');
  });

  it('rejects files that are not PE32 images', () => {
    expect(() => extractTables(new Uint8Array(0x100))).toThrow(PeFormatError);
  });
});
