import { describe, expect, it } from 'vitest';
import {
  SPR_FRAME_RECORD_SIZE,
  SPR_HEADER_SIZE,
  SPR_PALETTE_SIZE,
  SprFormatError,
  readSpr,
  readSprFrame,
  readSprPalette,
} from './spr';

interface FakeFrame {
  width: number;
  height: number;
  unknown3?: number;
  unknown4?: number;
  /** Overrides the stored size; defaults to width * height. */
  size?: number;
}

/**
 * Builds a synthetic SPR: "SPR\0", u32 count, u32 dataOffset, frame records,
 * 512-byte palette, 8-bit pixel data.
 */
function buildSpr(frames: FakeFrame[], dataOffset?: number): Uint8Array {
  const tableEnd = SPR_HEADER_SIZE + SPR_FRAME_RECORD_SIZE * frames.length;
  const sizes = frames.map((f) => f.size ?? f.width * f.height);
  const out = new Uint8Array(tableEnd + SPR_PALETTE_SIZE + sizes.reduce((a, b) => a + b, 0));
  const view = new DataView(out.buffer);
  out.set([0x53, 0x50, 0x52, 0x00]);
  view.setUint32(4, frames.length, true);
  view.setUint32(8, dataOffset ?? tableEnd, true);
  frames.forEach((f, i) => {
    const at = SPR_HEADER_SIZE + SPR_FRAME_RECORD_SIZE * i;
    view.setUint16(at, f.width, true);
    view.setUint16(at + 2, f.height, true);
    view.setInt16(at + 4, f.unknown3 ?? 0, true);
    view.setInt16(at + 6, f.unknown4 ?? 0, true);
    view.setUint32(at + 8, sizes[i]!, true);
  });
  // Palette entry i = i, so the slice is recognisable.
  for (let i = 0; i < 256; i++) view.setUint16(tableEnd + 2 * i, i, true);
  // Fill each frame's pixels with its index + 1 so slices are distinguishable.
  let pos = tableEnd + SPR_PALETTE_SIZE;
  sizes.forEach((size, i) => {
    out.fill(i + 1, pos, pos + size);
    pos += size;
  });
  return out;
}

function expectError(bytes: Uint8Array, code: SprFormatError['code']): void {
  let caught: unknown;
  try {
    readSpr(bytes);
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(SprFormatError);
  expect((caught as SprFormatError).code).toBe(code);
}

describe('readSpr', () => {
  it('reads frame records, palette and pixel offsets', () => {
    const bytes = buildSpr([
      { width: 2, height: 3 },
      { width: 4, height: 1, unknown3: 2, unknown4: 7 },
    ]);
    const spr = readSpr(bytes);

    expect(spr.dataOffset).toBe(36);
    expect(spr.paletteOffset).toBe(36);
    expect(spr.frames).toEqual([
      { index: 0, width: 2, height: 3, unknown3: 0, unknown4: 0, size: 6, offset: 548 },
      { index: 1, width: 4, height: 1, unknown3: 2, unknown4: 7, size: 4, offset: 554 },
    ]);
    expect(Array.from(readSprFrame(bytes, spr.frames[1]!))).toEqual([2, 2, 2, 2]);
  });

  it('reads unknown3/unknown4 as signed 16-bit values', () => {
    const spr = readSpr(buildSpr([{ width: 1, height: 1, unknown3: -68, unknown4: -103 }]));
    expect(spr.frames[0]).toMatchObject({ unknown3: -68, unknown4: -103 });
  });

  it('returns the 512-byte palette that follows the frame table', () => {
    const bytes = buildSpr([{ width: 1, height: 1 }]);
    const palette = readSprPalette(bytes, readSpr(bytes));
    const view = new DataView(palette.buffer, palette.byteOffset, palette.byteLength);

    expect(palette.length).toBe(SPR_PALETTE_SIZE);
    expect(view.getUint16(0, true)).toBe(0);
    expect(view.getUint16(2 * 255, true)).toBe(255);
  });

  it('accepts a sheet with zero frames', () => {
    expect(readSpr(buildSpr([])).frames).toEqual([]);
  });

  it('rejects data that is too small for the header', () => {
    expectError(new Uint8Array(11), 'too-small');
  });

  it('rejects a wrong magic', () => {
    const bytes = buildSpr([{ width: 1, height: 1 }]);
    bytes[0] = 0x58;
    expectError(bytes, 'bad-magic');
  });

  it('rejects a frame table that runs past the end', () => {
    const bytes = buildSpr([{ width: 1, height: 1 }]);
    new DataView(bytes.buffer).setUint32(4, 1000, true);
    expectError(bytes, 'too-small');
  });

  it('rejects a data offset that does not follow the frame table', () => {
    expectError(buildSpr([{ width: 1, height: 1 }], 28), 'bad-data-offset');
  });

  it('rejects data too small for the palette', () => {
    const bytes = buildSpr([]);
    expectError(bytes.subarray(0, bytes.length - 1), 'too-small');
  });

  it('rejects a frame size that is not width * height', () => {
    expectError(buildSpr([{ width: 2, height: 2, size: 8 }]), 'bad-frame-size');
  });

  it('rejects trailing or missing pixel bytes', () => {
    const bytes = buildSpr([{ width: 1, height: 1 }]);
    expectError(Uint8Array.from([...bytes, 0]), 'size-mismatch');
    expectError(bytes.subarray(0, bytes.length - 1), 'size-mismatch');
  });
});
