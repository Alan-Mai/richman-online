// Minimal PE32 reader: just enough to map virtual addresses to file bytes (see docs/ASSET_FORMATS.md,
// "rich4.exe 資料表"). Section names are not relied on: the original linker names its code section
// "AUTO", so code is recognised by the section characteristics instead.

export type PeErrorCode = 'not-mz' | 'not-pe' | 'not-pe32' | 'truncated';

export class PeFormatError extends Error {
  constructor(
    readonly code: PeErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PeFormatError';
  }
}

const SCN_CNT_CODE = 0x20;
const SCN_MEM_EXECUTE = 0x20000000;
const PE32_MAGIC = 0x10b;
const SECTION_HEADER_SIZE = 40;

export interface PeSection {
  name: string;
  /** Absolute virtual address (image base included). */
  va: number;
  /** Bytes backed by the file, starting at `va`; any virtual tail beyond this is zero-filled. */
  fileBackedSize: number;
  rawOffset: number;
  isCode: boolean;
}

export interface PeImage {
  imageBase: number;
  sections: PeSection[];
  /** Absolute virtual address of the import directory, or null when the image has none. */
  importDirectoryVa: number | null;
}

export function readPe(bytes: Uint8Array): PeImage {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const need = (end: number) => {
    if (end > bytes.length)
      throw new PeFormatError('truncated', `headers run past ${bytes.length} bytes`);
  };
  need(0x40);
  if (view.getUint16(0, true) !== 0x5a4d) throw new PeFormatError('not-mz', 'missing MZ signature');
  const pe = view.getUint32(0x3c, true);
  need(pe + 24);
  if (view.getUint32(pe, true) !== 0x00004550)
    throw new PeFormatError('not-pe', 'missing PE signature');
  const sectionCount = view.getUint16(pe + 6, true);
  const optionalSize = view.getUint16(pe + 20, true);
  const opt = pe + 24;
  need(opt + 32);
  if (view.getUint16(opt, true) !== PE32_MAGIC)
    throw new PeFormatError('not-pe32', 'not a PE32 image');
  const imageBase = view.getUint32(opt + 28, true);

  const table = opt + optionalSize;
  need(table + sectionCount * SECTION_HEADER_SIZE);
  const sections: PeSection[] = [];
  for (let i = 0; i < sectionCount; i++) {
    const s = table + i * SECTION_HEADER_SIZE;
    const nameBytes = bytes.subarray(s, s + 8);
    const nul = nameBytes.indexOf(0);
    const virtualSize = view.getUint32(s + 8, true);
    const rawSize = view.getUint32(s + 16, true);
    const rawOffset = view.getUint32(s + 20, true);
    const characteristics = view.getUint32(s + 36, true);
    // Some linkers leave VirtualSize at 0; the raw size is then the mapped size.
    const mapped = virtualSize === 0 ? rawSize : Math.min(virtualSize, rawSize);
    sections.push({
      name: new TextDecoder('latin1').decode(nul < 0 ? nameBytes : nameBytes.subarray(0, nul)),
      va: imageBase + view.getUint32(s + 12, true),
      fileBackedSize: rawOffset === 0 ? 0 : Math.max(0, Math.min(mapped, bytes.length - rawOffset)),
      rawOffset,
      isCode: (characteristics & (SCN_CNT_CODE | SCN_MEM_EXECUTE)) !== 0,
    });
  }
  // Data directory 1 (imports): RVA at optional header + 104, present when the header is that long.
  const importRva = optionalSize >= 112 ? view.getUint32(opt + 104, true) : 0;
  const importDirectoryVa = importRva === 0 ? null : imageBase + importRva;
  return { imageBase, sections, importDirectoryVa };
}

/** File bytes for [va, va + length), or undefined unless one section backs the whole range. */
export function readVa(
  bytes: Uint8Array,
  image: PeImage,
  va: number,
  length: number,
): Uint8Array | undefined {
  for (const s of image.sections) {
    if (va >= s.va && va + length <= s.va + s.fileBackedSize) {
      const at = s.rawOffset + (va - s.va);
      return bytes.subarray(at, at + length);
    }
  }
  return undefined;
}

/** True if some code section holds a 32-bit little-endian value in [start, end), at any alignment. */
export function codeReferencesRange(
  bytes: Uint8Array,
  image: PeImage,
  start: number,
  end: number,
): boolean {
  for (const s of image.sections) {
    if (!s.isCode) continue;
    const view = new DataView(bytes.buffer, bytes.byteOffset + s.rawOffset, s.fileBackedSize);
    for (let i = 0; i + 4 <= s.fileBackedSize; i++) {
      const v = view.getUint32(i, true);
      if (v >= start && v < end) return true;
    }
  }
  return false;
}
