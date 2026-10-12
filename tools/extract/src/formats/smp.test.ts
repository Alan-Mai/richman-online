import { describe, expect, it } from 'vitest';
import {
  SMP_FRAME_RECORD_SIZE,
  SMP_HEADER_SIZE,
  SmpFormatError,
  readSmp,
  readSmpFrame,
} from './smp';

interface FakeFrame {
  width: number;
  height: number;
  unknown3?: number;
  unknown4?: number;
  /** Overrides the stored size; defaults to width * height * 2. */
  size?: number;
}

/** Builds a synthetic SMP: "SMP\0", u32 count, u32 dataOffset, frame records, pixel data. */
function buildSmp(frames: FakeFrame[], dataOffset?: number): Uint8Array {
  const headerSize = SMP_HEADER_SIZE + SMP_FRAME_RECORD_SIZE * frames.length;
  const sizes = frames.map((f) => f.size ?? f.width * f.height * 2);
  const out = new Uint8Array(headerSize + sizes.reduce((a, b) => a + b, 0));
  const view = new DataView(out.buffer);
  out.set([0x53, 0x4d, 0x50, 0x00]);
  view.setUint32(4, frames.length, true);
  view.setUint32(8, dataOffset ?? headerSize, true);
  frames.forEach((f, i) => {
    const at = SMP_HEADER_SIZE + SMP_FRAME_RECORD_SIZE * i;
    view.setUint16(at, f.width, true);
    view.setUint16(at + 2, f.height, true);
    view.setUint16(at + 4, f.unknown3 ?? 0, true);
    view.setUint16(at + 6, f.unknown4 ?? 0, true);
    view.setUint32(at + 8, sizes[i]!, true);
  });
  // Fill each frame's pixels with its index so slices are distinguishable.
  let pos = headerSize;
  sizes.forEach((size, i) => {
    out.fill(i + 1, pos, pos + size);
    pos += size;
  });
  return out;
}

function expectError(bytes: Uint8Array, code: SmpFormatError['code']): void {
  let caught: unknown;
  try {
    readSmp(bytes);
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(SmpFormatError);
  expect((caught as SmpFormatError).code).toBe(code);
}

describe('readSmp', () => {
  it('reads frame records and computes pixel offsets', () => {
    const bytes = buildSmp([
      { width: 2, height: 3 },
      { width: 4, height: 1, unknown3: 2, unknown4: 0xffff },
    ]);
    const smp = readSmp(bytes);

    expect(smp.dataOffset).toBe(36);
    expect(smp.frames).toEqual([
      { index: 0, width: 2, height: 3, unknown3: 0, unknown4: 0, size: 12, offset: 36 },
      { index: 1, width: 4, height: 1, unknown3: 2, unknown4: 0xffff, size: 8, offset: 48 },
    ]);
    expect(Array.from(readSmpFrame(bytes, smp.frames[1]!))).toEqual(new Array(8).fill(2));
  });

  it('accepts a sheet with zero frames', () => {
    expect(readSmp(buildSmp([])).frames).toEqual([]);
  });

  it('rejects data that is too small for the header', () => {
    expectError(new Uint8Array(11), 'too-small');
  });

  it('rejects a wrong magic', () => {
    const bytes = buildSmp([{ width: 1, height: 1 }]);
    bytes[0] = 0x58;
    expectError(bytes, 'bad-magic');
  });

  it('rejects a frame table that runs past the end', () => {
    const bytes = buildSmp([{ width: 1, height: 1 }]);
    new DataView(bytes.buffer).setUint32(4, 1000, true);
    expectError(bytes, 'too-small');
  });

  it('rejects a data offset that does not follow the frame table', () => {
    expectError(buildSmp([{ width: 1, height: 1 }], 28), 'bad-data-offset');
  });

  it('rejects a frame size that is not width * height * 2', () => {
    expectError(buildSmp([{ width: 2, height: 2, size: 4 }]), 'bad-frame-size');
  });

  it('rejects trailing or missing pixel bytes', () => {
    const bytes = buildSmp([{ width: 1, height: 1 }]);
    expectError(Uint8Array.from([...bytes, 0]), 'size-mismatch');
    expectError(bytes.subarray(0, bytes.length - 1), 'size-mismatch');
  });
});
