// MKF archive container (see docs/ASSET_FORMATS.md, "MKF 容器"):
//   u32 tableOffset | entries... | u32 entryOffset[N] at [tableOffset, EOF)
// Each entry is a 16-byte header (rawSize, storedSize, unknown3, unknown4) followed by
// storedSize bytes of payload; the last entry ends at tableOffset.
import type { ByteSource } from './byte-source';

export const MKF_ENTRY_HEADER_SIZE = 16;

export interface MkfEntry {
  index: number;
  /** Absolute offset of the entry header. */
  offset: number;
  rawSize: number;
  storedSize: number;
  /** Meaning not yet known; kept verbatim. */
  unknown3: number;
  /** Meaning not yet known; kept verbatim. */
  unknown4: number;
  /** Absolute offset of the first payload byte. */
  payloadOffset: number;
}

export type MkfErrorCode =
  | 'too-small'
  | 'bad-table-offset'
  | 'bad-first-offset'
  | 'not-increasing'
  | 'out-of-range'
  | 'span-mismatch';

export class MkfFormatError extends Error {
  constructor(
    readonly code: MkfErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'MkfFormatError';
  }
}

const u32 = (bytes: Uint8Array, at: number) =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(at, true);

/** Reads only the offset table and the entry headers. Strict: any inconsistency throws. */
export function readMkfIndex(src: ByteSource): MkfEntry[] {
  if (src.size < 4) throw new MkfFormatError('too-small', `file is ${src.size} bytes`);

  const tableOffset = u32(src.read(0, 4), 0);
  const tableSize = src.size - tableOffset;
  if (tableOffset < 4 || tableOffset > src.size || tableSize % 4 !== 0) {
    throw new MkfFormatError(
      'bad-table-offset',
      `table offset ${tableOffset} does not fit file size ${src.size}`,
    );
  }

  const table = src.read(tableOffset, tableSize);
  const offsets = Array.from({ length: tableSize / 4 }, (_, i) => u32(table, 4 * i));

  offsets.forEach((offset, i) => {
    if (i === 0 && offset !== 4) {
      throw new MkfFormatError('bad-first-offset', `entry 0 starts at ${offset}, expected 4`);
    }
    if (i > 0 && offset <= offsets[i - 1]!) {
      throw new MkfFormatError('not-increasing', `entry ${i} offset ${offset} is not increasing`);
    }
    if (offset + MKF_ENTRY_HEADER_SIZE > tableOffset) {
      throw new MkfFormatError('out-of-range', `entry ${i} header at ${offset} overlaps the table`);
    }
  });

  return offsets.map((offset, index) => {
    const header = src.read(offset, MKF_ENTRY_HEADER_SIZE);
    const entry: MkfEntry = {
      index,
      offset,
      rawSize: u32(header, 0),
      storedSize: u32(header, 4),
      unknown3: u32(header, 8),
      unknown4: u32(header, 12),
      payloadOffset: offset + MKF_ENTRY_HEADER_SIZE,
    };
    const end = offsets[index + 1] ?? tableOffset;
    if (entry.payloadOffset + entry.storedSize !== end) {
      throw new MkfFormatError(
        'span-mismatch',
        `entry ${index} stores ${entry.storedSize} bytes but spans ${end - entry.payloadOffset}`,
      );
    }
    return entry;
  });
}

export function readMkfPayload(src: ByteSource, entry: MkfEntry): Uint8Array {
  return src.read(entry.payloadOffset, entry.storedSize);
}
