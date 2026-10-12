// SPR 8-bit sprite sheet (see docs/ASSET_FORMATS.md, "SPR 精靈圖集"):
//   "SPR\0" | u32 frameCount | u32 dataOffset | frameCount x 12-byte records
//   | 512-byte RGB555 palette (256 colours) at dataOffset | pixel data
// Record: u16 width, u16 height, i16 unknown3, i16 unknown4, u32 size.
// Frames are stored back to back after the palette as width * height palette indices.

export const SPR_HEADER_SIZE = 12;
export const SPR_FRAME_RECORD_SIZE = 12;
export const SPR_PALETTE_SIZE = 512;
const MAGIC = [0x53, 0x50, 0x52, 0x00];

export interface SprFrame {
  index: number;
  width: number;
  height: number;
  /** Meaning not yet known; kept verbatim, read as int16 (see ASSET_FORMATS.md). */
  unknown3: number;
  /** Meaning not yet known; kept verbatim, read as int16 (see ASSET_FORMATS.md). */
  unknown4: number;
  /** Pixel byte count (one palette index per pixel). */
  size: number;
  /** Offset of the first pixel byte within the SPR data. */
  offset: number;
}

export interface SprSheet {
  dataOffset: number;
  /** Offset of the 512-byte palette; equal to dataOffset. */
  paletteOffset: number;
  frames: SprFrame[];
}

export type SprErrorCode =
  'too-small' | 'bad-magic' | 'bad-data-offset' | 'bad-frame-size' | 'size-mismatch';

export class SprFormatError extends Error {
  constructor(
    readonly code: SprErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SprFormatError';
  }
}

/** Parses the header, frame records and palette position. Strict: any inconsistency throws. */
export function readSpr(bytes: Uint8Array): SprSheet {
  if (bytes.length < SPR_HEADER_SIZE) {
    throw new SprFormatError('too-small', `${bytes.length} bytes`);
  }
  if (MAGIC.some((b, i) => bytes[i] !== b)) {
    throw new SprFormatError('bad-magic', 'missing "SPR\\0" magic');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const frameCount = view.getUint32(4, true);
  const dataOffset = view.getUint32(8, true);
  const tableEnd = SPR_HEADER_SIZE + SPR_FRAME_RECORD_SIZE * frameCount;
  if (tableEnd > bytes.length) {
    throw new SprFormatError(
      'too-small',
      `${frameCount} frame records exceed ${bytes.length} bytes`,
    );
  }
  if (dataOffset !== tableEnd) {
    throw new SprFormatError('bad-data-offset', `data offset ${dataOffset}, expected ${tableEnd}`);
  }
  if (dataOffset + SPR_PALETTE_SIZE > bytes.length) {
    throw new SprFormatError('too-small', `no room for the palette in ${bytes.length} bytes`);
  }

  let offset = dataOffset + SPR_PALETTE_SIZE;
  const frames = Array.from({ length: frameCount }, (_, index): SprFrame => {
    const at = SPR_HEADER_SIZE + SPR_FRAME_RECORD_SIZE * index;
    const frame: SprFrame = {
      index,
      width: view.getUint16(at, true),
      height: view.getUint16(at + 2, true),
      unknown3: view.getInt16(at + 4, true),
      unknown4: view.getInt16(at + 6, true),
      size: view.getUint32(at + 8, true),
      offset,
    };
    if (frame.size !== frame.width * frame.height) {
      throw new SprFormatError(
        'bad-frame-size',
        `frame ${index} is ${frame.width}x${frame.height} but stores ${frame.size} bytes`,
      );
    }
    offset += frame.size;
    return frame;
  });

  if (offset !== bytes.length) {
    throw new SprFormatError(
      'size-mismatch',
      `frames end at ${offset}, data is ${bytes.length} bytes`,
    );
  }
  return { dataOffset, paletteOffset: dataOffset, frames };
}

/** The 256 RGB555 palette entries as raw bytes (decode with rgb555ToRgba(palette, 256, 1)). */
export function readSprPalette(bytes: Uint8Array, sheet: SprSheet): Uint8Array {
  return bytes.subarray(sheet.paletteOffset, sheet.paletteOffset + SPR_PALETTE_SIZE);
}

/** The frame's width * height palette indices, row by row. */
export function readSprFrame(bytes: Uint8Array, frame: SprFrame): Uint8Array {
  return bytes.subarray(frame.offset, frame.offset + frame.size);
}
