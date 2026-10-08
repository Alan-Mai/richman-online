import { describe, expect, it } from 'vitest';
import { bufferByteSource } from './byte-source';
import { MKF_ENTRY_HEADER_SIZE, MkfFormatError, readMkfIndex, readMkfPayload } from './mkf';

interface FakeEntry {
  payload: Uint8Array;
  rawSize?: number;
  unknown3?: number;
  unknown4?: number;
}

/** Builds a synthetic MKF: u32 tailOff, entries (16-byte header + payload), then the offset table. */
function buildMkf(entries: FakeEntry[]): Uint8Array {
  const bodySize = entries.reduce((n, e) => n + MKF_ENTRY_HEADER_SIZE + e.payload.length, 0);
  const tailOff = 4 + bodySize;
  const out = new Uint8Array(tailOff + 4 * entries.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, tailOff, true);
  let pos = 4;
  entries.forEach((e, i) => {
    view.setUint32(tailOff + 4 * i, pos, true);
    view.setUint32(pos, e.rawSize ?? e.payload.length, true);
    view.setUint32(pos + 4, e.payload.length, true);
    view.setUint32(pos + 8, e.unknown3 ?? 0, true);
    view.setUint32(pos + 12, e.unknown4 ?? 0, true);
    out.set(e.payload, pos + MKF_ENTRY_HEADER_SIZE);
    pos += MKF_ENTRY_HEADER_SIZE + e.payload.length;
  });
  return out;
}

const text = (s: string) => new TextEncoder().encode(s);

function setU32(bytes: Uint8Array, offset: number, value: number): Uint8Array {
  const copy = bytes.slice();
  new DataView(copy.buffer).setUint32(offset, value, true);
  return copy;
}

function expectError(bytes: Uint8Array, code: MkfFormatError['code']): void {
  let caught: unknown;
  try {
    readMkfIndex(bufferByteSource(bytes));
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(MkfFormatError);
  expect((caught as MkfFormatError).code).toBe(code);
}

describe('readMkfIndex', () => {
  it('reads every entry header and payload range', () => {
    const bytes = buildMkf([
      { payload: text('測試假資料一'), unknown3: 12, unknown4: 512 },
      { payload: new Uint8Array(0) },
      { payload: Uint8Array.from([1, 2, 3]), rawSize: 9 },
    ]);
    const entries = readMkfIndex(bufferByteSource(bytes));

    expect(entries).toHaveLength(3);
    expect(entries[0]).toEqual({
      index: 0,
      offset: 4,
      rawSize: 18,
      storedSize: 18,
      unknown3: 12,
      unknown4: 512,
      payloadOffset: 20,
    });
    expect(entries[1]).toMatchObject({ offset: 38, storedSize: 0, payloadOffset: 54 });
    expect(entries[2]).toMatchObject({ offset: 54, rawSize: 9, storedSize: 3 });
  });

  it('accepts an archive with no entries', () => {
    expect(readMkfIndex(bufferByteSource(buildMkf([])))).toEqual([]);
  });

  it('rejects input shorter than the table pointer', () => {
    expectError(Uint8Array.from([4, 0]), 'too-small');
  });

  it('rejects a table pointer outside the file', () => {
    const bytes = buildMkf([{ payload: text('a') }]);
    expectError(setU32(bytes, 0, bytes.length + 4), 'bad-table-offset');
    expectError(setU32(bytes, 0, 2), 'bad-table-offset');
  });

  it('rejects a table whose length is not a multiple of 4', () => {
    const bytes = buildMkf([{ payload: text('ab') }]);
    expectError(setU32(bytes, 0, 23), 'bad-table-offset');
  });

  it('rejects a first entry that does not start right after the table pointer', () => {
    const bytes = buildMkf([{ payload: text('abcdefgh') }]);
    expectError(setU32(bytes, bytes.length - 4, 8), 'bad-first-offset');
  });

  it('rejects offsets that do not strictly increase', () => {
    const bytes = buildMkf([{ payload: text('a') }, { payload: text('b') }]);
    expectError(setU32(bytes, bytes.length - 4, 4), 'not-increasing');
  });

  it('rejects an entry header that runs past the table', () => {
    const bytes = buildMkf([{ payload: text('a') }, { payload: text('b') }]);
    const tailOff = bytes.length - 8;
    expectError(setU32(bytes, bytes.length - 4, tailOff - 8), 'out-of-range');
  });

  it('rejects an entry whose span disagrees with its stored size', () => {
    const bytes = buildMkf([{ payload: text('abc') }, { payload: text('d') }]);
    expectError(setU32(bytes, 4 + 4, 2), 'span-mismatch');
    const last = 4 + MKF_ENTRY_HEADER_SIZE + 3;
    expectError(setU32(bytes, last + 4, 5), 'span-mismatch');
  });
});

describe('readMkfPayload', () => {
  it('returns exactly the stored bytes of one entry', () => {
    const bytes = buildMkf([{ payload: text('前') }, { payload: text('後面的假資料') }]);
    const src = bufferByteSource(bytes);
    const entries = readMkfIndex(src);
    expect(new TextDecoder().decode(readMkfPayload(src, entries[1]!))).toBe('後面的假資料');
  });
});

describe('bufferByteSource', () => {
  it('refuses reads past the end', () => {
    const src = bufferByteSource(Uint8Array.from([1, 2, 3]));
    expect(Array.from(src.read(1, 2))).toEqual([2, 3]);
    expect(() => src.read(2, 2)).toThrow(RangeError);
  });
});
