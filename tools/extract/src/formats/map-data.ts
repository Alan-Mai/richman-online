// Map data, the odd subfiles of map.mkf (see docs/ASSET_FORMATS.md, "地圖資料"):
//   80-byte header of 20 u32: n0, base0, n1, off1, n2, off2, n3, off3, n4, off4, 10 x unused
//   | section 0 (squares): n0 records of 40 bytes right after the header
//   | sections 1-4 at offK: one all-zero record, then nK records (strides 52, 56, 52, 28)
// Each section's offset points at a virtual record 0 and the game uses records 1..n. For squares
// that base is 40, so record 0 overlaps the header and record 1 starts at byte 80.
// Every record starts with i16 x, i16 y (pixels on the GND background) and a Big5 name at +4.
// References into sections are 1-based on disk with 0 meaning "none"; this parser turns them
// into 0-based indices into the arrays it returns (the all-zero record is dropped).
// Field meanings come from analysing the game's loader and rules (see ASSET_FORMATS.md); fields
// that are zero on disk and only hold run-time state (owner, last toll, ...) are not read, except
// the building level, which is kept as read.

export const MAP_DATA_HEADER_SIZE = 80;
export const MAP_DATA_STRIDES = [40, 52, 56, 52, 28] as const;
export const MAP_DATA_NAME_SIZE = 10;
const LINK_SLOTS = 4;
/** Highest building level; section 1 has a toll per level 0..MAX, section 2 per level 1..MAX. */
export const MAP_MAX_LEVEL = 5;
/** `spriteIndex` + this = the map.mkf subfile holding the record's image. */
export const MAP_SPRITE_SUBFILE_OFFSET = 38;

/** `MapSquare.flags`: leaving through link slot k is blocked (one way; entering is allowed). */
export const SQUARE_FLAG_BLOCKED_SLOTS = [0x4000, 0x2000, 0x1000, 0x0800] as const;
/** `MapSquare.flags`: never chosen as a random start or teleport target. */
export const SQUARE_FLAG_NO_RANDOM_PLACEMENT = 0x8000;

/** Whether `flags` blocks leaving through link slot `slot` (0-3). */
export function blockedSlot(flags: number, slot: number): boolean {
  const bit = SQUARE_FLAG_BLOCKED_SLOTS[slot];
  if (bit === undefined) throw new RangeError(`link slot ${slot}`);
  return (flags & bit) !== 0;
}

/** Whether `flags` excludes the square from random placement. */
export function noRandomPlacement(flags: number): boolean {
  return (flags & SQUARE_FLAG_NO_RANDOM_PLACEMENT) !== 0;
}

/** Fields every record starts with. */
export interface MapRecordBase {
  /** Pixel position on the GND background. */
  x: number;
  y: number;
  /** Name bytes up to the first NUL (Big5; decode with decodeMapName). */
  nameBytes: Uint8Array;
}

export type MapSectionNumber = 1 | 2 | 3 | 4;

export interface MapRef {
  section: MapSectionNumber;
  /** 0-based index into that section's records. */
  index: number;
}

export interface MapSquare extends MapRecordBase {
  /** The four neighbour slots at +24..+30 as 0-based square indices, null when empty. Undirected. */
  links: (number | null)[];
  /** The typed reference at +32 (stored as 1000 * (2 * section) + 1-based index), or null. */
  ref: MapRef | null;
  /** Meaning not yet known; kept verbatim (u16). */
  unknownAt34: number;
  /** Low half of the u32 at +36; the low byte looks like a square kind (not yet traced). */
  unknownAt36: number;
  /**
   * High half of the u32 at +36, kept verbatim so untraced bits survive. Read it with
   * blockedSlot / noRandomPlacement.
   */
  flags: number;
}

/** Fields shared by plots (section 1) and large building lots (section 2). */
export interface MapLotFields {
  /** Building level (byte +26); zero on disk, the game keeps it there at run time. */
  level: number;
  /** Byte +27; only bit 0 is used, to pick a sprite variant. No effect on rules. */
  displayFlags: number;
  /** Cost of each building level, a fixed amount per lot. */
  upgradeCost: number;
}

/** Section 1 record (52 bytes): an ordinary plot. */
export interface MapSection1Record extends MapRecordBase, MapLotFields {
  landPrice: number;
  /** Toll at levels 0..MAP_MAX_LEVEL (u16 at +32..+42). */
  tolls: number[];
}

/** Section 2 record (56 bytes): a large building lot. */
export interface MapSection2Record extends MapRecordBase, MapLotFields {
  /** Paid once to buy the lot and again to build on it at level 0. */
  price: number;
  /** Toll at levels 1..MAP_MAX_LEVEL (u16 at +38..+46). */
  tolls: number[];
}

/** Section 3 record (52 bytes): a location. Unknown fields are u16, kept verbatim. */
export interface MapSection3Record extends MapRecordBase {
  unknownAt24: number;
  unknownAt26: number;
  /** Image: map.mkf subfile spriteIndex + MAP_SPRITE_SUBFILE_OFFSET. */
  spriteIndex: number;
  unknownAt34: number;
  unknownAt36: number;
  unknownAt38: number;
}

/** Section 4 record (28 bytes): a label or image. */
export interface MapSection4Record extends MapRecordBase {
  /** Meaning not yet known; kept verbatim (u16). */
  unknownAt24: number;
  /** Image: map.mkf subfile spriteIndex + MAP_SPRITE_SUBFILE_OFFSET. */
  spriteIndex: number;
}

export interface MapData {
  squares: MapSquare[];
  section1: MapSection1Record[];
  section2: MapSection2Record[];
  section3: MapSection3Record[];
  section4: MapSection4Record[];
}

export type MapDataErrorCode =
  | 'too-small'
  | 'bad-square-base'
  | 'bad-offset'
  | 'size-mismatch'
  | 'bad-dummy'
  | 'bad-link'
  | 'bad-ref';

export class MapDataFormatError extends Error {
  constructor(
    readonly code: MapDataErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'MapDataFormatError';
  }
}

const big5 = new TextDecoder('big5');

/** Decodes a record name. Not strict: invalid bytes become U+FFFD. */
export function decodeMapName(nameBytes: Uint8Array): string {
  return big5.decode(nameBytes);
}

/** Parses all five sections. Strict on structure: any inconsistency throws. */
export function readMapData(bytes: Uint8Array): MapData {
  if (bytes.length < MAP_DATA_HEADER_SIZE) {
    throw new MapDataFormatError('too-small', `${bytes.length} bytes`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (at: number) => view.getUint16(at, true);
  const slot = (i: number) => view.getUint32(4 * i, true);

  // Squares have no dummy record: their base sits one stride before the end of the header.
  if (slot(1) !== MAP_DATA_HEADER_SIZE - MAP_DATA_STRIDES[0]) {
    throw new MapDataFormatError(
      'bad-square-base',
      `header slot 1 (square base offset) is ${slot(1)}, expected 40`,
    );
  }
  // Section k: count and first byte. Sections 1-4 hold an extra all-zero record first.
  const counts = [slot(0), slot(2), slot(4), slot(6), slot(8)];
  const starts = [MAP_DATA_HEADER_SIZE, slot(3), slot(5), slot(7), slot(9)];
  const ends = [...starts.slice(1), bytes.length];
  for (let k = 0; k < 5; k++) {
    const length = (counts[k]! + (k === 0 ? 0 : 1)) * MAP_DATA_STRIDES[k]!;
    if (starts[k]! > bytes.length) {
      throw new MapDataFormatError(
        'bad-offset',
        `section ${k} starts at ${starts[k]} of ${bytes.length}`,
      );
    }
    if (starts[k]! + length !== ends[k]) {
      throw new MapDataFormatError(
        k === 4 ? 'size-mismatch' : 'bad-offset',
        `section ${k} spans ${starts[k]}+${length}, next starts at ${ends[k]}`,
      );
    }
    if (
      k > 0 &&
      bytes.subarray(starts[k], starts[k]! + MAP_DATA_STRIDES[k]!).some((b) => b !== 0)
    ) {
      throw new MapDataFormatError('bad-dummy', `section ${k} record 0 is not all zero`);
    }
  }

  // Byte offset of the i-th (0-based, dummy excluded) record of section k.
  const recordAt = (k: number, i: number) =>
    starts[k]! + (i + (k === 0 ? 0 : 1)) * MAP_DATA_STRIDES[k]!;
  const records = <T>(k: number, read: (at: number) => T): T[] =>
    Array.from({ length: counts[k]! }, (_, i) => read(recordAt(k, i)));
  const base = (at: number): MapRecordBase => {
    const field = bytes.subarray(at + 4, at + 4 + MAP_DATA_NAME_SIZE);
    const nul = field.indexOf(0);
    return {
      x: view.getInt16(at, true),
      y: view.getInt16(at + 2, true),
      nameBytes: nul < 0 ? field : field.subarray(0, nul),
    };
  };

  const squares = records(0, (at): MapSquare => {
    const links = Array.from({ length: LINK_SLOTS }, (_, s) => {
      const v = u16(at + 24 + 2 * s);
      if (v > counts[0]!) {
        throw new MapDataFormatError(
          'bad-link',
          `link ${v} at ${at + 24 + 2 * s}, ${counts[0]} squares`,
        );
      }
      return v === 0 ? null : v - 1;
    });
    return {
      ...base(at),
      links,
      ref: readRef(u16(at + 32), counts, at + 32),
      unknownAt34: u16(at + 34),
      unknownAt36: u16(at + 36),
      flags: u16(at + 38),
    };
  });
  const u16s = (at: number, count: number) =>
    Array.from({ length: count }, (_, i) => u16(at + 2 * i));

  return {
    squares,
    section1: records(1, (at) => ({
      ...base(at),
      level: bytes[at + 26]!,
      displayFlags: bytes[at + 27]!,
      landPrice: u16(at + 28),
      upgradeCost: u16(at + 30),
      tolls: u16s(at + 32, MAP_MAX_LEVEL + 1),
    })),
    section2: records(2, (at) => ({
      ...base(at),
      level: bytes[at + 26]!,
      displayFlags: bytes[at + 27]!,
      price: u16(at + 34),
      upgradeCost: u16(at + 36),
      tolls: u16s(at + 38, MAP_MAX_LEVEL),
    })),
    section3: records(3, (at) => ({
      ...base(at),
      unknownAt24: u16(at + 24),
      unknownAt26: u16(at + 26),
      spriteIndex: u16(at + 32),
      unknownAt34: u16(at + 34),
      unknownAt36: u16(at + 36),
      unknownAt38: u16(at + 38),
    })),
    section4: records(4, (at) => ({
      ...base(at),
      unknownAt24: u16(at + 24),
      spriteIndex: u16(at + 26),
    })),
  };
}

// Stored value: 1000 * class + 1-based index, class 0 = none, 2/4/6/8 = section 1/2/3/4.
function readRef(value: number, counts: number[], at: number): MapRef | null {
  if (value === 0) return null;
  const cls = Math.floor(value / 1000);
  const k = value % 1000;
  const section = cls / 2;
  if (!Number.isInteger(section) || section < 1 || section > 4 || k < 1 || k > counts[section]!) {
    throw new MapDataFormatError('bad-ref', `reference ${value} at ${at}`);
  }
  return { section: section as MapSectionNumber, index: k - 1 };
}
