import { describe, expect, it } from 'vitest';
import { findDword, readImports } from './exe-search';
import { buildFakePe } from './formats/fake-pe';
import { readPe } from './formats/pe';

// Everything below is made up for the tests.
const BASE = 0x400000;

describe('findDword', () => {
  it('finds a value at any alignment in every section', () => {
    const code = new Uint8Array(16);
    new DataView(code.buffer).setUint32(5, 0x00412345, true);
    const data = new Uint8Array(32);
    new DataView(data.buffer).setUint32(3, 0x00412345, true);
    new DataView(data.buffer).setUint32(20, 0x00412345, true);
    const bytes = buildFakePe(BASE, [
      { name: 'CODE', rva: 0x1000, data: code, code: true },
      { name: 'DATA', rva: 0x2000, data },
    ]);
    expect(findDword(bytes, readPe(bytes), 0x00412345)).toEqual([
      { va: BASE + 0x1005, section: 'CODE' },
      { va: BASE + 0x2003, section: 'DATA' },
      { va: BASE + 0x2014, section: 'DATA' },
    ]);
    expect(findDword(bytes, readPe(bytes), 0x00499999)).toEqual([]);
  });
});

/** An import directory at RVA 0x3000 with one DLL: a function by name and one by ordinal. */
function importSection(withLookupTable: boolean): Uint8Array {
  const r = 0x3000;
  const data = new Uint8Array(0x100);
  const view = new DataView(data.buffer);
  view.setUint32(0x00, withLookupTable ? r + 0x40 : 0, true); // lookup table
  view.setUint32(0x0c, r + 0x80, true); // DLL name
  view.setUint32(0x10, r + 0x60, true); // import address table
  for (const table of [0x40, 0x60]) {
    view.setUint32(table, r + 0x90, true);
    view.setUint32(table + 4, 0x80000007, true);
  }
  data.set(new TextEncoder().encode('FAKE.DLL'), 0x80);
  data.set(new TextEncoder().encode('MadeUpCall'), 0x92);
  return data;
}

describe('readImports', () => {
  it('lists each import with its address table slot', () => {
    for (const withLookupTable of [true, false]) {
      const bytes = buildFakePe(
        BASE,
        [{ name: 'IMP', rva: 0x3000, data: importSection(withLookupTable) }],
        0x3000,
      );
      expect(readImports(bytes, readPe(bytes))).toEqual([
        { va: BASE + 0x3060, dll: 'FAKE.DLL', name: 'MadeUpCall' },
        { va: BASE + 0x3064, dll: 'FAKE.DLL', name: '#7' },
      ]);
    }
  });

  it('is empty without an import directory', () => {
    const bytes = buildFakePe(BASE, [{ name: 'DATA', rva: 0x2000, data: new Uint8Array(16) }]);
    expect(readPe(bytes).importDirectoryVa).toBeNull();
    expect(readImports(bytes, readPe(bytes))).toEqual([]);
  });
});
