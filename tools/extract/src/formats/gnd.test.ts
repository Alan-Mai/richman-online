import { describe, expect, it } from 'vitest';
import {
  GND_HEADER_SIZE,
  GND_PALETTE_SIZE,
  GND_TILE_SIDE,
  GND_TILE_SIZE,
  GndFormatError,
  composeGnd,
  readGnd,
  readGndPalette,
  readGndTile,
} from './gnd';

interface FakeGnd {
  columns: number;
  rows: number;
  /** Tile index per cell; defaults to 0, 1, 2, ... */
  cellTiles?: number[];
  /** Number of stored tiles; defaults to columns * rows. */
  tileCount?: number;
  unknownAt8?: number;
  unknownAt12?: number;
}

/**
 * Builds a synthetic GND: "GND\0", u16 columns, u16 rows, u32, u32, 512-byte palette,
 * u16 cell table, 32x32 8-bit tiles. Tile t is filled with the value t + 1.
 */
function buildGnd(g: FakeGnd): Uint8Array {
  const cells = g.columns * g.rows;
  const cellTiles = g.cellTiles ?? Array.from({ length: cells }, (_, i) => i);
  const tileCount = g.tileCount ?? cells;
  const tilesOffset = GND_HEADER_SIZE + GND_PALETTE_SIZE + 2 * cells;
  const out = new Uint8Array(tilesOffset + tileCount * GND_TILE_SIZE);
  const view = new DataView(out.buffer);
  out.set([0x47, 0x4e, 0x44, 0x00]);
  view.setUint16(4, g.columns, true);
  view.setUint16(6, g.rows, true);
  view.setUint32(8, g.unknownAt8 ?? cells, true);
  view.setUint32(12, g.unknownAt12 ?? 0, true);
  // Palette entry i = i, so the slice is recognisable.
  for (let i = 0; i < 256; i++) view.setUint16(GND_HEADER_SIZE + 2 * i, i, true);
  cellTiles.forEach((t, i) => view.setUint16(GND_HEADER_SIZE + GND_PALETTE_SIZE + 2 * i, t, true));
  for (let t = 0; t < tileCount; t++) {
    out.fill(t + 1, tilesOffset + t * GND_TILE_SIZE, tilesOffset + (t + 1) * GND_TILE_SIZE);
  }
  return out;
}

function expectError(bytes: Uint8Array, code: GndFormatError['code']): void {
  let caught: unknown;
  try {
    readGnd(bytes);
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(GndFormatError);
  expect((caught as GndFormatError).code).toBe(code);
}

describe('readGnd', () => {
  it('reads the header, cell table and tile layout', () => {
    const gnd = readGnd(buildGnd({ columns: 3, rows: 2, unknownAt8: 6, unknownAt12: 9 }));

    expect(gnd).toEqual({
      columns: 3,
      rows: 2,
      unknownAt8: 6,
      unknownAt12: 9,
      paletteOffset: 16,
      cellTiles: [0, 1, 2, 3, 4, 5],
      tilesOffset: 16 + 512 + 12,
      tileCount: 6,
    });
  });

  it('allows cells to share tiles and tiles to go unused', () => {
    const gnd = readGnd(buildGnd({ columns: 2, rows: 1, cellTiles: [2, 2], tileCount: 3 }));
    expect(gnd.cellTiles).toEqual([2, 2]);
    expect(gnd.tileCount).toBe(3);
  });

  it('returns the 512-byte palette after the header', () => {
    const bytes = buildGnd({ columns: 1, rows: 1 });
    const palette = readGndPalette(bytes, readGnd(bytes));
    const view = new DataView(palette.buffer, palette.byteOffset, palette.byteLength);

    expect(palette.length).toBe(GND_PALETTE_SIZE);
    expect(view.getUint16(2 * 255, true)).toBe(255);
  });

  it('accepts an empty grid with no tiles', () => {
    expect(readGnd(buildGnd({ columns: 0, rows: 0 }))).toMatchObject({
      cellTiles: [],
      tileCount: 0,
    });
  });

  it('rejects data that is too small for the header and palette', () => {
    expectError(buildGnd({ columns: 0, rows: 0 }).subarray(0, 527), 'too-small');
  });

  it('rejects a wrong magic', () => {
    const bytes = buildGnd({ columns: 1, rows: 1 });
    bytes[0] = 0x58;
    expectError(bytes, 'bad-magic');
  });

  it('rejects a cell table that runs past the end', () => {
    const bytes = buildGnd({ columns: 1, rows: 1 });
    new DataView(bytes.buffer).setUint16(4, 1000, true);
    expectError(bytes, 'too-small');
  });

  it('rejects tile data that is not a whole number of tiles', () => {
    const bytes = buildGnd({ columns: 1, rows: 1 });
    expectError(Uint8Array.from([...bytes, 0]), 'size-mismatch');
    expectError(bytes.subarray(0, bytes.length - 1), 'size-mismatch');
  });

  it('rejects a cell that points past the last tile', () => {
    expectError(
      buildGnd({ columns: 2, rows: 1, cellTiles: [0, 2], tileCount: 2 }),
      'bad-tile-index',
    );
  });
});

describe('readGndTile', () => {
  it('returns one tile of 32x32 indices', () => {
    const bytes = buildGnd({ columns: 2, rows: 1 });
    const tile = readGndTile(bytes, readGnd(bytes), 1);
    expect(tile.length).toBe(GND_TILE_SIZE);
    expect(tile.every((v) => v === 2)).toBe(true);
  });

  it('rejects a tile index out of range', () => {
    const bytes = buildGnd({ columns: 1, rows: 1 });
    expect(() => readGndTile(bytes, readGnd(bytes), 1)).toThrow(RangeError);
  });
});

describe('composeGnd', () => {
  it('places each cell tile at its grid position', () => {
    // 2x2 grid, cells use tiles [3, 0, 1, 1] out of 4 stored tiles.
    const bytes = buildGnd({ columns: 2, rows: 2, cellTiles: [3, 0, 1, 1], tileCount: 4 });
    // Mark pixel (5, 1) of tile 0 to check row-major order inside a tile.
    bytes[16 + 512 + 8 + 1 * GND_TILE_SIDE + 5] = 99;
    const pixels = composeGnd(bytes, readGnd(bytes));
    const width = 2 * GND_TILE_SIDE;
    const at = (x: number, y: number) => pixels[y * width + x];

    expect(pixels.length).toBe(width * 2 * GND_TILE_SIDE);
    expect(at(0, 0)).toBe(4);
    expect(at(31, 31)).toBe(4);
    expect(at(32, 0)).toBe(1);
    expect(at(32 + 5, 1)).toBe(99);
    expect(at(32 + 1, 5)).toBe(1);
    expect(at(0, 32)).toBe(2);
    expect(at(63, 63)).toBe(2);
  });
});
