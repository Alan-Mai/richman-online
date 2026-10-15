// Test helper: builds a synthetic PE32 image in memory. Contents are whatever the test supplies.

export interface FakeSection {
  name: string;
  /** Relative virtual address. */
  rva: number;
  data: Uint8Array;
  code?: boolean;
  /** Defaults to data.length; 0 imitates linkers that leave VirtualSize empty. */
  virtualSize?: number;
}

const PE_OFFSET = 0x40;
const OPTIONAL_SIZE = 0xe0;
const FILE_ALIGN = 0x200;

export function buildFakePe(imageBase: number, sections: FakeSection[]): Uint8Array {
  const headerEnd = PE_OFFSET + 24 + OPTIONAL_SIZE + 40 * sections.length;
  const align = (n: number) => Math.ceil(n / FILE_ALIGN) * FILE_ALIGN;
  let raw = align(headerEnd);
  const placed = sections.map((s) => {
    const at = raw;
    raw += align(s.data.length);
    return at;
  });
  const out = new Uint8Array(raw);
  const view = new DataView(out.buffer);
  view.setUint16(0, 0x5a4d, true);
  view.setUint32(0x3c, PE_OFFSET, true);
  view.setUint32(PE_OFFSET, 0x00004550, true);
  view.setUint16(PE_OFFSET + 4, 0x14c, true);
  view.setUint16(PE_OFFSET + 6, sections.length, true);
  view.setUint16(PE_OFFSET + 20, OPTIONAL_SIZE, true);
  const opt = PE_OFFSET + 24;
  view.setUint16(opt, 0x10b, true);
  view.setUint32(opt + 28, imageBase, true);
  sections.forEach((s, i) => {
    const h = opt + OPTIONAL_SIZE + 40 * i;
    out.set(new TextEncoder().encode(s.name.slice(0, 8)), h);
    view.setUint32(h + 8, s.virtualSize ?? s.data.length, true);
    view.setUint32(h + 12, s.rva, true);
    view.setUint32(h + 16, align(s.data.length), true);
    view.setUint32(h + 20, placed[i]!, true);
    view.setUint32(h + 36, s.code ? 0x60000020 : 0xc0000040, true);
    out.set(s.data, placed[i]);
  });
  return out;
}

/** Code bytes that mention each address once as a 32-bit little-endian operand. */
export function fakeCodeReferencing(addresses: number[]): Uint8Array {
  const out = new Uint8Array(addresses.length * 6);
  const view = new DataView(out.buffer);
  addresses.forEach((a, i) => {
    out[i * 6] = 0x90;
    out[i * 6 + 1] = 0x90;
    view.setUint32(i * 6 + 2, a, true);
  });
  return out;
}
