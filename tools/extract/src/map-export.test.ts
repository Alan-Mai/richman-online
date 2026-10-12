import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { parseMapArgs } from './commands/map';
import type { MkfEntry } from './formats/mkf';
import { MapExportError, countMaps, exportMap, mapEntryIndices } from './map-export';

/** Synthetic 2x1-cell GND: palette entry i = RGB555 value i, tile t filled with t + 1. */
function buildGnd(): Uint8Array {
  const cells = 2;
  const tilesOffset = 16 + 512 + 2 * cells;
  const out = new Uint8Array(tilesOffset + cells * 1024);
  const view = new DataView(out.buffer);
  out.set([0x47, 0x4e, 0x44, 0x00]);
  view.setUint16(4, 2, true);
  view.setUint16(6, 1, true);
  view.setUint32(8, cells, true);
  view.setUint16(16 + 2 * 2, 0x7c00, true); // entry 2 = pure red
  view.setUint16(528, 0, true);
  view.setUint16(530, 1, true);
  out.fill(1, tilesOffset, tilesOffset + 1024);
  out.fill(2, tilesOffset + 1024);
  return out;
}

/** Synthetic map data: two linked squares, the first referencing the only section-1 record. */
function buildMapData(): Uint8Array {
  const sec1 = 80 + 2 * 40;
  const ends = [sec1 + 2 * 52, sec1 + 2 * 52 + 56, sec1 + 2 * 52 + 56 + 52];
  const out = new Uint8Array(ends[2]! + 28);
  const view = new DataView(out.buffer);
  view.setUint32(0, 2, true);
  view.setUint32(4, 40, true);
  view.setUint32(8, 1, true);
  view.setUint32(12, sec1, true);
  view.setUint32(20, ends[0]!, true);
  view.setUint32(28, ends[1]!, true);
  view.setUint32(36, ends[2]!, true);
  // Square 0 at (5, 6) named "測試" (made-up Big5), linked to square 1, referencing section 1.
  view.setInt16(80, 5, true);
  view.setInt16(82, 6, true);
  out.set([0xb4, 0xfa, 0xb8, 0xd5], 84);
  view.setUint16(80 + 24, 2, true);
  view.setUint16(80 + 32, 2001, true);
  view.setUint16(120 + 24, 1, true);
  view.setInt16(sec1 + 52, 7, true);
  return out;
}

function entry(index: number, fields: Partial<MkfEntry>): MkfEntry {
  return {
    index,
    offset: 0,
    rawSize: 1,
    storedSize: 1,
    unknown3: 0,
    unknown4: 0,
    payloadOffset: 0,
    ...fields,
  };
}

describe('mapEntryIndices', () => {
  it('pairs map n with subfiles 2n and 2n + 1', () => {
    expect(mapEntryIndices(3)).toEqual({ gnd: 6, data: 7 });
  });
});

describe('countMaps', () => {
  const gnd = (i: number) => entry(i, { unknown3: 16, unknown4: 512 });
  const data = (i: number) => entry(i, {});

  it('counts leading GND + map data pairs', () => {
    expect(countMaps([gnd(0), data(1), gnd(2), data(3), entry(4, { rawSize: 9 })])).toBe(2);
  });

  it('stops at a compressed or mismatched entry', () => {
    expect(countMaps([gnd(0), entry(1, { rawSize: 2 })])).toBe(0);
    expect(countMaps([data(0), data(1)])).toBe(0);
    expect(countMaps([gnd(0)])).toBe(0);
  });
});

describe('parseMapArgs', () => {
  it('selects every map when no argument is given', () => {
    expect(parseMapArgs([], 3)).toEqual([0, 1, 2]);
  });

  it('accepts map numbers in range', () => {
    expect(parseMapArgs(['2', '0'], 3)).toEqual([2, 0]);
  });

  it('rejects numbers out of range or malformed', () => {
    for (const bad of ['3', '-1', '1.5', 'x', '']) {
      expect(() => parseMapArgs([bad], 3)).toThrow(MapExportError);
    }
  });
});

describe('exportMap', () => {
  const { backgroundPng, json } = exportMap(4, buildGnd(), buildMapData(), '2026-01-01T00:00:00Z');

  it('writes the background as an indexed PNG of the composed tiles', () => {
    expect(backgroundPng.readUInt32BE(16)).toBe(64); // IHDR width
    expect(backgroundPng.readUInt32BE(20)).toBe(32); // IHDR height
    expect(backgroundPng[25]).toBe(3); // colour type: indexed

    // PLTE follows IHDR; entry 2 is pure red.
    const plteAt = 8 + 12 + 13;
    expect(backgroundPng.toString('ascii', plteAt + 4, plteAt + 8)).toBe('PLTE');
    expect([...backgroundPng.subarray(plteAt + 8 + 6, plteAt + 8 + 9)]).toEqual([255, 0, 0]);

    const idatAt = plteAt + 12 + 768;
    expect(backgroundPng.toString('ascii', idatAt + 4, idatAt + 8)).toBe('IDAT');
    const raw = inflateSync(
      backgroundPng.subarray(idatAt + 8, idatAt + 8 + backgroundPng.readUInt32BE(idatAt)),
    );
    // Row 0: filter byte, 32 pixels of tile 0 (value 1), 32 of tile 1 (value 2).
    expect(raw[0]).toBe(0);
    expect(raw[1]).toBe(1);
    expect(raw[33]).toBe(2);
  });

  it('describes the map with decoded names and 0-based references', () => {
    expect(json).toMatchObject({
      version: 1,
      generatedAt: '2026-01-01T00:00:00Z',
      map: 4,
      source: { file: 'map.mkf', gndIndex: 8, dataIndex: 9 },
      background: {
        file: 'background.png',
        width: 64,
        height: 32,
        columns: 2,
        rows: 1,
        tileSize: 32,
      },
      squares: [
        { x: 5, y: 6, name: '測試', links: [1, null, null, null], ref: { section: 1, index: 0 } },
        { name: '', links: [0, null, null, null], ref: null },
      ],
      section1: [{ x: 7, name: '' }],
      section2: [],
      section3: [],
      section4: [],
    });
    expect(JSON.stringify(json)).not.toContain('nameBytes');
  });
});
