import { describe, expect, it } from 'vitest';
import { Rgb555FormatError, countBit15, rgb555ToRgba } from './rgb555';

function pixels(values: number[]): Uint8Array {
  const out = new Uint8Array(2 * values.length);
  const view = new DataView(out.buffer);
  values.forEach((v, i) => view.setUint16(2 * i, v, true));
  return out;
}

describe('rgb555ToRgba', () => {
  it('expands 5-bit channels to 8 bits, little-endian, opaque', () => {
    const rgba = rgb555ToRgba(pixels([0x7c00, 0x03e0, 0x001f, 0x0000, 0x7fff, 0x4210]), 3, 2);
    // prettier-ignore
    expect(Array.from(rgba)).toEqual([
      255, 0, 0, 255,
      0, 255, 0, 255,
      0, 0, 255, 255,
      0, 0, 0, 255,
      255, 255, 255, 255,
      132, 132, 132, 255,
    ]);
  });

  it('ignores bit 15 instead of rejecting it', () => {
    const rgba = rgb555ToRgba(pixels([0x8000 | 0x001f]), 1, 1);
    expect(Array.from(rgba)).toEqual([0, 0, 255, 255]);
  });

  it('rejects a buffer whose length is not width * height * 2', () => {
    expect(() => rgb555ToRgba(new Uint8Array(5), 1, 3)).toThrow(Rgb555FormatError);
    expect(() => rgb555ToRgba(new Uint8Array(8), 1, 3)).toThrow(Rgb555FormatError);
  });

  it('respects the byte offset of a subarray view', () => {
    const backing = new Uint8Array([0xaa, ...pixels([0x7c00])]);
    expect(Array.from(rgb555ToRgba(backing.subarray(1), 1, 1))).toEqual([255, 0, 0, 255]);
  });
});

describe('countBit15', () => {
  it('counts pixels whose top bit is set', () => {
    expect(countBit15(pixels([0x8000, 0x7fff, 0xffff, 0x0001]))).toBe(2);
  });

  it('rejects an odd-length buffer', () => {
    expect(() => countBit15(new Uint8Array(3))).toThrow(Rgb555FormatError);
  });
});
