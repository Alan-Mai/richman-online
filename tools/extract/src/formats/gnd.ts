// GND tiled map background (see docs/ASSET_FORMATS.md, "GND 地圖背景"):
//   "GND\0" | u16 columns | u16 rows | u32 unknownAt8 | u32 unknownAt12
//   | 512-byte RGB555 palette (256 colours) at 16 | columns * rows u16 cell tile indices
//   | tiles, each 32 x 32 palette indices, row by row
// The tile size is not stored in the header; 32 x 32 is inferred from the data length and
// confirmed by rendering. The tile count is whatever fills the rest of the data.

export const GND_HEADER_SIZE = 16;
export const GND_PALETTE_SIZE = 512;
export const GND_TILE_SIDE = 32;
export const GND_TILE_SIZE = GND_TILE_SIDE * GND_TILE_SIDE;
const MAGIC = [0x47, 0x4e, 0x44, 0x00];

export interface GndMap {
  /** Grid width in cells. */
  columns: number;
  /** Grid height in cells. */
  rows: number;
  /** Meaning not yet known; kept verbatim. */
  unknownAt8: number;
  /** Meaning not yet known; kept verbatim. */
  unknownAt12: number;
  /** Offset of the 512-byte palette; always GND_HEADER_SIZE. */
  paletteOffset: number;
  /** Tile index of each cell, row by row (columns * rows entries). */
  cellTiles: number[];
  /** Offset of tile 0. */
  tilesOffset: number;
  tileCount: number;
}

export type GndErrorCode = 'too-small' | 'bad-magic' | 'size-mismatch' | 'bad-tile-index';

export class GndFormatError extends Error {
  constructor(
    readonly code: GndErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'GndFormatError';
  }
}

/** Parses the header, palette position and cell table. Strict: any inconsistency throws. */
export function readGnd(bytes: Uint8Array): GndMap {
  if (bytes.length < GND_HEADER_SIZE + GND_PALETTE_SIZE) {
    throw new GndFormatError('too-small', `${bytes.length} bytes`);
  }
  if (MAGIC.some((b, i) => bytes[i] !== b)) {
    throw new GndFormatError('bad-magic', 'missing "GND\\0" magic');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const columns = view.getUint16(4, true);
  const rows = view.getUint16(6, true);
  const cellCount = columns * rows;
  const tableOffset = GND_HEADER_SIZE + GND_PALETTE_SIZE;
  const tilesOffset = tableOffset + 2 * cellCount;
  if (tilesOffset > bytes.length) {
    throw new GndFormatError(
      'too-small',
      `${columns}x${rows} cell table exceeds ${bytes.length} bytes`,
    );
  }
  const tileBytes = bytes.length - tilesOffset;
  if (tileBytes % GND_TILE_SIZE !== 0) {
    throw new GndFormatError(
      'size-mismatch',
      `${tileBytes} tile bytes is not a multiple of ${GND_TILE_SIZE}`,
    );
  }
  const tileCount = tileBytes / GND_TILE_SIZE;
  const cellTiles = Array.from({ length: cellCount }, (_, i) => {
    const tile = view.getUint16(tableOffset + 2 * i, true);
    if (tile >= tileCount) {
      throw new GndFormatError('bad-tile-index', `cell ${i} uses tile ${tile} of ${tileCount}`);
    }
    return tile;
  });
  return {
    columns,
    rows,
    unknownAt8: view.getUint32(8, true),
    unknownAt12: view.getUint32(12, true),
    paletteOffset: GND_HEADER_SIZE,
    cellTiles,
    tilesOffset,
    tileCount,
  };
}

/** The 256 RGB555 palette entries as raw bytes (decode with rgb555ToRgba(palette, 256, 1)). */
export function readGndPalette(bytes: Uint8Array, gnd: GndMap): Uint8Array {
  return bytes.subarray(gnd.paletteOffset, gnd.paletteOffset + GND_PALETTE_SIZE);
}

/** One tile's 32 * 32 palette indices, row by row. */
export function readGndTile(bytes: Uint8Array, gnd: GndMap, tile: number): Uint8Array {
  if (!Number.isInteger(tile) || tile < 0 || tile >= gnd.tileCount) {
    throw new RangeError(`tile ${tile} of ${gnd.tileCount}`);
  }
  const at = gnd.tilesOffset + tile * GND_TILE_SIZE;
  return bytes.subarray(at, at + GND_TILE_SIZE);
}

/** The whole background as (columns * 32) x (rows * 32) palette indices, row by row. */
export function composeGnd(bytes: Uint8Array, gnd: GndMap): Uint8Array {
  const width = gnd.columns * GND_TILE_SIDE;
  const out = new Uint8Array(width * gnd.rows * GND_TILE_SIDE);
  gnd.cellTiles.forEach((tile, cell) => {
    const pixels = readGndTile(bytes, gnd, tile);
    const left = (cell % gnd.columns) * GND_TILE_SIDE;
    const top = Math.floor(cell / gnd.columns) * GND_TILE_SIDE;
    for (let y = 0; y < GND_TILE_SIDE; y++) {
      out.set(
        pixels.subarray(y * GND_TILE_SIDE, (y + 1) * GND_TILE_SIDE),
        (top + y) * width + left,
      );
    }
  });
  return out;
}
