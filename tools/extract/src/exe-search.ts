// Lookups in rich4.exe for reverse engineering (.claude/skills/asset-analyze/SKILL.md): where a
// 32-bit value is stored (pointer tables that reach a function with no direct caller), and which
// Windows API an import slot holds. Results are addresses and API names, never table contents.
import { readVa, type PeImage } from './formats/pe';

export interface DwordHit {
  /** Virtual address of the first byte of the match (any alignment). */
  va: number;
  section: string;
}

/** Every place in the file-backed section data that holds `value` as a little-endian u32. */
export function findDword(bytes: Uint8Array, image: PeImage, value: number): DwordHit[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const hits: DwordHit[] = [];
  for (const s of image.sections) {
    for (let i = 0; i + 4 <= s.fileBackedSize; i++) {
      if (view.getUint32(s.rawOffset + i, true) === value >>> 0) {
        hits.push({ va: s.va + i, section: s.name });
      }
    }
  }
  return hits;
}

export interface ImportSlot {
  /** Virtual address of the import address table slot, as code refers to it. */
  va: number;
  dll: string;
  /** The API name, or `#<ordinal>` for an import by ordinal. */
  name: string;
}

const DESCRIPTOR_SIZE = 20;
const ORDINAL_FLAG = 0x80000000;

/** Every imported function with its slot in the import address table. */
export function readImports(bytes: Uint8Array, image: PeImage): ImportSlot[] {
  const at = image.importDirectoryVa;
  if (at === null) return [];
  const u32 = (va: number): number => {
    const b = readVa(bytes, image, va, 4);
    if (!b) throw new Error(`import data at 0x${va.toString(16)} is not in the file`);
    return new DataView(b.buffer, b.byteOffset, 4).getUint32(0, true);
  };
  const text = (va: number): string => {
    let s = '';
    for (let p = va; ; p++) {
      const c = readVa(bytes, image, p, 1)?.[0];
      if (c === undefined) throw new Error(`string at 0x${va.toString(16)} runs off the file`);
      if (c === 0) return s;
      s += String.fromCharCode(c);
    }
  };

  const slots: ImportSlot[] = [];
  for (let d = at; ; d += DESCRIPTOR_SIZE) {
    const lookupRva = u32(d);
    const nameRva = u32(d + 12);
    const iatRva = u32(d + 16);
    if (nameRva === 0) break;
    const dll = text(image.imageBase + nameRva);
    // Some linkers leave the lookup table out; the address table then still holds the names.
    const source = image.imageBase + (lookupRva !== 0 ? lookupRva : iatRva);
    for (let k = 0; ; k++) {
      const entry = u32(source + 4 * k);
      if (entry === 0) break;
      // A name entry starts with a 2-byte hint.
      const name = entry & ORDINAL_FLAG ? `#${entry & 0xffff}` : text(image.imageBase + entry + 2);
      slots.push({ va: image.imageBase + iatRva + 4 * k, dll, name });
    }
  }
  return slots;
}
