// SMP sprite sheet (see docs/ASSET_FORMATS.md, "SMP 精靈圖集"):
//   "SMP\0" | u32 frameCount | u32 dataOffset | frameCount x 12-byte records | pixel data
// Record: u16 width, u16 height, u16 unknown3, u16 unknown4, u32 size.
// Frames are stored back to back from dataOffset as width * height RGB555 pixels.

export const SMP_HEADER_SIZE = 12;
export const SMP_FRAME_RECORD_SIZE = 12;
const MAGIC = [0x53, 0x4d, 0x50, 0x00];

export interface SmpFrame {
  index: number;
  width: number;
  height: number;
  /** Meaning not yet known; kept verbatim. */
  unknown3: number;
  /** Meaning not yet known; kept verbatim. */
  unknown4: number;
  /** Pixel byte count. */
  size: number;
  /** Offset of the first pixel byte within the SMP data. */
  offset: number;
}

export interface SmpSheet {
  dataOffset: number;
  frames: SmpFrame[];
}

export type SmpErrorCode =
  'too-small' | 'bad-magic' | 'bad-data-offset' | 'bad-frame-size' | 'size-mismatch';

export class SmpFormatError extends Error {
  constructor(
    readonly code: SmpErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SmpFormatError';
  }
}

/** Parses the header and frame records. Strict: any inconsistency throws. */
export function readSmp(bytes: Uint8Array): SmpSheet {
  if (bytes.length < SMP_HEADER_SIZE) {
    throw new SmpFormatError('too-small', `${bytes.length} bytes`);
  }
  if (MAGIC.some((b, i) => bytes[i] !== b)) {
    throw new SmpFormatError('bad-magic', 'missing "SMP\\0" magic');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const frameCount = view.getUint32(4, true);
  const dataOffset = view.getUint32(8, true);
  const tableEnd = SMP_HEADER_SIZE + SMP_FRAME_RECORD_SIZE * frameCount;
  if (tableEnd > bytes.length) {
    throw new SmpFormatError(
      'too-small',
      `${frameCount} frame records exceed ${bytes.length} bytes`,
    );
  }
  if (dataOffset !== tableEnd) {
    throw new SmpFormatError('bad-data-offset', `data offset ${dataOffset}, expected ${tableEnd}`);
  }

  let offset = dataOffset;
  const frames = Array.from({ length: frameCount }, (_, index): SmpFrame => {
    const at = SMP_HEADER_SIZE + SMP_FRAME_RECORD_SIZE * index;
    const frame: SmpFrame = {
      index,
      width: view.getUint16(at, true),
      height: view.getUint16(at + 2, true),
      unknown3: view.getUint16(at + 4, true),
      unknown4: view.getUint16(at + 6, true),
      size: view.getUint32(at + 8, true),
      offset,
    };
    if (frame.size !== frame.width * frame.height * 2) {
      throw new SmpFormatError(
        'bad-frame-size',
        `frame ${index} is ${frame.width}x${frame.height} but stores ${frame.size} bytes`,
      );
    }
    offset += frame.size;
    return frame;
  });

  if (offset !== bytes.length) {
    throw new SmpFormatError(
      'size-mismatch',
      `frames end at ${offset}, data is ${bytes.length} bytes`,
    );
  }
  return { dataOffset, frames };
}

export function readSmpFrame(bytes: Uint8Array, frame: SmpFrame): Uint8Array {
  return bytes.subarray(frame.offset, frame.offset + frame.size);
}
