// Turns a parsed GND background and its map data into files for local-assets/maps/<n>/.
// Pure: the command in commands/map.ts does the I/O.
import { GND_TILE_SIDE, composeGnd, readGnd, readGndPalette } from './formats/gnd';
import { decodeMapName, readMapData, type MapRecordBase } from './formats/map-data';
import type { MkfEntry } from './formats/mkf';
import { encodePngIndexed } from './png';
import { rgb555ToRgba } from './formats/rgb555';

// Bump when a field is renamed or changes meaning. The client reports older versions as outdated
// and asks to run `cli map` again (apps/client/src/assets/map-preview.ts).
export const MAP_JSON_VERSION = 2;

export class MapExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MapExportError';
  }
}

/** Map n is the GND at subfile 2n followed by its map data at 2n + 1 (see ASSET_FORMATS.md). */
export function mapEntryIndices(n: number): { gnd: number; data: number } {
  return { gnd: 2 * n, data: 2 * n + 1 };
}

/** Number of maps: leading (GND, map data) pairs, recognised by the MKF header fields. */
export function countMaps(entries: MkfEntry[]): number {
  let n = 0;
  for (;;) {
    const { gnd, data } = mapEntryIndices(n);
    const g = entries[gnd];
    const d = entries[data];
    const isGnd = g && g.rawSize === g.storedSize && g.unknown3 === 16 && g.unknown4 === 512;
    const isData = d && d.rawSize === d.storedSize && d.unknown3 === 0 && d.unknown4 === 0;
    if (!isGnd || !isData) return n;
    n++;
  }
}

function withName<T extends MapRecordBase>({ nameBytes, ...rest }: T) {
  return { ...rest, name: decodeMapName(nameBytes) };
}

export interface ExportedMap {
  backgroundPng: Buffer;
  json: unknown;
}

/** Builds background.png and map.json for one map. Throws the parsers' format errors. */
export function exportMap(
  n: number,
  gndBytes: Uint8Array,
  dataBytes: Uint8Array,
  generatedAt: string,
): ExportedMap {
  const gnd = readGnd(gndBytes);
  const data = readMapData(dataBytes);
  const width = gnd.columns * GND_TILE_SIDE;
  const height = gnd.rows * GND_TILE_SIDE;
  if (width === 0 || height === 0) throw new MapExportError(`map ${n} has an empty background`);

  const palette = rgb555ToRgba(readGndPalette(gndBytes, gnd), 256, 1);
  const backgroundPng = encodePngIndexed(width, height, composeGnd(gndBytes, gnd), palette);
  const { gnd: gndIndex, data: dataIndex } = mapEntryIndices(n);
  const json = {
    version: MAP_JSON_VERSION,
    generatedAt,
    map: n,
    source: { file: 'map.mkf', gndIndex, dataIndex },
    background: {
      file: 'background.png',
      width,
      height,
      columns: gnd.columns,
      rows: gnd.rows,
      tileSize: GND_TILE_SIDE,
    },
    squares: data.squares.map(withName),
    section1: data.section1.map(withName),
    section2: data.section2.map(withName),
    section3: data.section3.map(withName),
    section4: data.section4.map(withName),
  };
  return { backgroundPng, json };
}
