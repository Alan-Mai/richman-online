import { describe, expect, it } from 'vitest';
import { buildFakePe, fakeCodeReferencing } from './fake-pe';
import { PeFormatError, codeReferencesRange, readPe, readVa } from './pe';

const BASE = 0x400000;

function expectCode(bytes: Uint8Array, code: PeFormatError['code']): void {
  let error: unknown;
  try {
    readPe(bytes);
  } catch (e) {
    error = e;
  }
  expect(error).toBeInstanceOf(PeFormatError);
  expect((error as PeFormatError).code).toBe(code);
}

describe('readPe', () => {
  const data = Uint8Array.from({ length: 0x30 }, (_, i) => i);
  const exe = buildFakePe(BASE, [
    { name: 'AUTO', rva: 0x1000, data: fakeCodeReferencing([BASE + 0x2010]), code: true },
    { name: 'DGROUP', rva: 0x2000, data, virtualSize: 0 },
    { name: '.bss', rva: 0x3000, data: new Uint8Array(0), virtualSize: 0x100 },
  ]);

  it('lists sections with absolute addresses and code flags', () => {
    const image = readPe(exe);
    expect(image.imageBase).toBe(BASE);
    expect(image.sections.map((s) => [s.name, s.va, s.isCode])).toEqual([
      ['AUTO', BASE + 0x1000, true],
      ['DGROUP', BASE + 0x2000, false],
      ['.bss', BASE + 0x3000, false],
    ]);
  });

  it('maps a virtual address to file bytes; VirtualSize 0 means the raw size', () => {
    const image = readPe(exe);
    expect(Array.from(readVa(exe, image, BASE + 0x2004, 3)!)).toEqual([4, 5, 6]);
    expect(readVa(exe, image, BASE + 0x3000, 1)).toBeUndefined();
    expect(readVa(exe, image, BASE + 0x0fff, 2)).toBeUndefined();
  });

  it('finds absolute addresses in code sections only', () => {
    const image = readPe(exe);
    expect(codeReferencesRange(exe, image, BASE + 0x2000, BASE + 0x2011)).toBe(true);
    expect(codeReferencesRange(exe, image, BASE + 0x2011, BASE + 0x2030)).toBe(false);
    // The data section holds bytes 0x00..0x2f, which never form an address in this range.
    expect(codeReferencesRange(exe, image, 0x03020100, 0x03020101)).toBe(false);
  });

  it('rejects bad headers', () => {
    expectCode(new Uint8Array(0x10), 'truncated');
    const noMz = exe.slice();
    noMz[0] = 0;
    expectCode(noMz, 'not-mz');
    const noPe = exe.slice();
    noPe[0x40] = 0;
    expectCode(noPe, 'not-pe');
    const pe32plus = exe.slice();
    new DataView(pe32plus.buffer).setUint16(0x40 + 24, 0x20b, true);
    expectCode(pe32plus, 'not-pe32');
  });
});
