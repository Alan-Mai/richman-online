import { describe, expect, it } from 'vitest';
import {
  MAP_DATA_HEADER_SIZE,
  MAP_DATA_STRIDES,
  MapDataFormatError,
  blockedSlot,
  decodeMapName,
  noRandomPlacement,
  readMapData,
} from './map-data';

interface FakeRecord {
  x?: number;
  y?: number;
  name?: number[];
  /** u16 values by byte offset within the record. */
  u16?: Record<number, number>;
}

/**
 * Builds synthetic map data: 80-byte header (n0, 40, then count/offset pairs), section 0 records,
 * then sections 1-4 each led by an all-zero record.
 */
/** `sections[k]` lists the records of section k (missing = empty). */
function buildMapData(sections: FakeRecord[][] = []): Uint8Array {
  const secs = [0, 1, 2, 3, 4].map((k) => sections[k] ?? []);
  const starts: number[] = [];
  let pos = MAP_DATA_HEADER_SIZE;
  secs.forEach((recs, k) => {
    starts.push(pos);
    pos += (recs.length + (k === 0 ? 0 : 1)) * MAP_DATA_STRIDES[k]!;
  });
  const out = new Uint8Array(pos);
  const view = new DataView(out.buffer);
  view.setUint32(0, secs[0]!.length, true);
  view.setUint32(4, 40, true);
  for (let k = 1; k < 5; k++) {
    view.setUint32(8 * k, secs[k]!.length, true);
    view.setUint32(8 * k + 4, starts[k]!, true);
  }
  secs.forEach((recs, k) => {
    recs.forEach((r, i) => {
      const at = starts[k]! + (i + (k === 0 ? 0 : 1)) * MAP_DATA_STRIDES[k]!;
      view.setInt16(at, r.x ?? 0, true);
      view.setInt16(at + 2, r.y ?? 0, true);
      out.set(r.name ?? [], at + 4);
      for (const [off, v] of Object.entries(r.u16 ?? {})) view.setUint16(at + Number(off), v, true);
    });
  });
  return out;
}

function expectError(bytes: Uint8Array, code: MapDataFormatError['code']): void {
  let caught: unknown;
  try {
    readMapData(bytes);
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(MapDataFormatError);
  expect((caught as MapDataFormatError).code).toBe(code);
}

// Made-up Big5 text ("測試").
const TEST_NAME = [0xb4, 0xfa, 0xb8, 0xd5];

describe('readMapData', () => {
  it('reads squares with position, name, links, reference and unknown fields', () => {
    const data = readMapData(
      buildMapData([
        [
          { x: 10, y: -3, name: TEST_NAME, u16: { 24: 2, 32: 2001, 34: 7, 36: 8, 38: 0x8000 } },
          { x: 50, y: 20, u16: { 24: 1, 28: 1 } },
        ],
        [{}],
      ]),
    );

    expect(data.squares).toHaveLength(2);
    const [a, b] = data.squares;
    expect(a).toMatchObject({
      x: 10,
      y: -3,
      links: [1, null, null, null],
      ref: { section: 1, index: 0 },
      unknownAt34: 7,
      unknownAt36: 8,
      flags: 0x8000,
    });
    expect(decodeMapName(a!.nameBytes)).toBe('測試');
    expect(b).toMatchObject({ links: [0, null, 0, null], ref: null });
    expect(b!.nameBytes.length).toBe(0);
  });

  it('maps each reference class to its section', () => {
    const data = readMapData(
      buildMapData([
        [{ u16: { 32: 4001 } }, { u16: { 32: 6002 } }, { u16: { 32: 8001 } }],
        [],
        [{}],
        [{}, {}],
        [{}],
      ]),
    );
    expect(data.squares.map((s) => s.ref)).toEqual([
      { section: 2, index: 0 },
      { section: 3, index: 1 },
      { section: 4, index: 0 },
    ]);
  });

  it('reads the records of sections 1-4 without the leading all-zero record', () => {
    const data = readMapData(
      buildMapData([
        [],
        [{ x: 1, y: 2, u16: { 26: 0x0302, 28: 9, 30: 4, 32: 1, 42: 0xfff0 } }],
        [{ x: 3, u16: { 26: 0x0104, 34: 5, 36: 2, 38: 1, 46: 0x8001 } }],
        [{ x: 4, u16: { 24: 0x0200, 26: 6, 32: 7, 34: 8, 36: 0xffff, 38: 9 } }],
        [{ x: 5, name: TEST_NAME, u16: { 24: 3, 26: 200 } }, { x: 6 }],
      ]),
    );

    expect(data.section1).toEqual([
      {
        x: 1,
        y: 2,
        nameBytes: new Uint8Array(),
        level: 2,
        displayFlags: 3,
        landPrice: 9,
        upgradeCost: 4,
        tolls: [1, 0, 0, 0, 0, 0xfff0],
      },
    ]);
    expect(data.section2).toEqual([
      {
        x: 3,
        y: 0,
        nameBytes: new Uint8Array(),
        level: 4,
        displayFlags: 1,
        price: 5,
        upgradeCost: 2,
        tolls: [1, 0, 0, 0, 0x8001],
      },
    ]);
    expect(data.section3[0]).toMatchObject({
      x: 4,
      unknownAt24: 0x0200,
      unknownAt26: 6,
      spriteIndex: 7,
      unknownAt34: 8,
      unknownAt36: 0xffff,
      unknownAt38: 9,
    });
    expect(data.section4.map((r) => r.x)).toEqual([5, 6]);
    expect(data.section4[0]).toMatchObject({ unknownAt24: 3, spriteIndex: 200 });
    expect(decodeMapName(data.section4[0]!.nameBytes)).toBe('測試');
  });

  it('accepts a name that fills the whole 10-byte field', () => {
    const name = [...TEST_NAME, ...TEST_NAME, 0xb4, 0xfa];
    const data = readMapData(buildMapData([[{ name }]]));
    expect(Array.from(data.squares[0]!.nameBytes)).toEqual(name);
  });

  it('accepts empty sections', () => {
    expect(readMapData(buildMapData())).toEqual({
      squares: [],
      section1: [],
      section2: [],
      section3: [],
      section4: [],
    });
  });

  it('rejects data that is too small for the header', () => {
    expectError(new Uint8Array(79), 'too-small');
  });

  it('rejects a square base offset other than 40', () => {
    const bytes = buildMapData();
    new DataView(bytes.buffer).setUint32(4, 44, true);
    expectError(bytes, 'bad-square-base');
  });

  it('rejects a section offset that does not follow the previous section', () => {
    const bytes = buildMapData([[{}]]);
    new DataView(bytes.buffer).setUint32(12, MAP_DATA_HEADER_SIZE, true);
    expectError(bytes, 'bad-offset');
  });

  it('rejects an offset past the end', () => {
    const bytes = buildMapData();
    new DataView(bytes.buffer).setUint32(36, bytes.length + 1, true);
    expectError(bytes, 'bad-offset');
  });

  it('rejects trailing or missing bytes after the last section', () => {
    const bytes = buildMapData([[], [], [], [], [{}]]);
    expectError(Uint8Array.from([...bytes, 0]), 'size-mismatch');
    expectError(bytes.subarray(0, bytes.length - 1), 'size-mismatch');
  });

  it('rejects a leading record that is not all zero', () => {
    const bytes = buildMapData([[], [{}]]);
    bytes[new DataView(bytes.buffer).getUint32(12, true) + 5] = 1;
    expectError(bytes, 'bad-dummy');
  });

  it('rejects a link past the last square', () => {
    expectError(buildMapData([[{ u16: { 30: 2 } }]]), 'bad-link');
  });

  it('rejects malformed references', () => {
    expectError(buildMapData([[{ u16: { 32: 5 } }]]), 'bad-ref'); // class 0 with an index
    expectError(buildMapData([[{ u16: { 32: 3001 } }], [{}]]), 'bad-ref'); // odd class
    expectError(buildMapData([[{ u16: { 32: 10001 } }]]), 'bad-ref'); // class 10
    expectError(buildMapData([[{ u16: { 32: 2000 } }], [{}]]), 'bad-ref'); // index 0
    expectError(buildMapData([[{ u16: { 32: 2002 } }], [{}]]), 'bad-ref'); // past the end
  });
});

describe('square flags', () => {
  it('reads the one-way block of each link slot, slot 0 at bit 14 down to slot 3 at bit 11', () => {
    expect([0, 1, 2, 3].map((k) => blockedSlot(0x4000, k))).toEqual([true, false, false, false]);
    expect([0, 1, 2, 3].map((k) => blockedSlot(0x0800, k))).toEqual([false, false, false, true]);
    expect([0, 1, 2, 3].map((k) => blockedSlot(0x2000 | 0x8000 | 0x07ff, k))).toEqual([
      false,
      true,
      false,
      false,
    ]);
  });

  it('rejects a slot outside 0-3', () => {
    expect(() => blockedSlot(0, 4)).toThrow(RangeError);
    expect(() => blockedSlot(0, -1)).toThrow(RangeError);
  });

  it('reads the no-random-placement bit', () => {
    expect(noRandomPlacement(0x8000)).toBe(true);
    expect(noRandomPlacement(0x7fff)).toBe(false);
  });
});
