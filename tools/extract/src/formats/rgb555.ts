// 16-bit little-endian RGB555 pixels (see docs/ASSET_FORMATS.md, "RGB555 像素"):
//   bit 15 unused | bits 14-10 red | bits 9-5 green | bits 4-0 blue

export class Rgb555FormatError extends Error {
  readonly code = 'size-mismatch';

  constructor(message: string) {
    super(message);
    this.name = 'Rgb555FormatError';
  }
}

// Expands 5 bits to 8 by bit replication: 0 -> 0 and 31 -> 255, within 1 of
// Math.round(v * 255 / 31) using integer ops only. A plain `v << 3` would top out at 248.
const expand5 = (v: number) => (v << 3) | (v >> 2);

const view = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

/**
 * Converts width * height RGB555 pixels to opaque RGBA8888.
 * Bit 15 is ignored rather than rejected: it is never set in the local copy's assets, but it
 * may act as a flag (e.g. transparency) elsewhere, and rejecting it would block conversion.
 * Use countBit15 in collection-mode checks to notice if it ever appears.
 */
export function rgb555ToRgba(pixels: Uint8Array, width: number, height: number): Uint8Array {
  const count = width * height;
  if (pixels.length !== 2 * count) {
    throw new Rgb555FormatError(`${pixels.length} bytes for ${width}x${height} pixels`);
  }
  const src = view(pixels);
  const out = new Uint8Array(4 * count);
  for (let i = 0; i < count; i++) {
    const x = src.getUint16(2 * i, true);
    out[4 * i] = expand5((x >> 10) & 31);
    out[4 * i + 1] = expand5((x >> 5) & 31);
    out[4 * i + 2] = expand5(x & 31);
    out[4 * i + 3] = 255;
  }
  return out;
}

/** Number of pixels with bit 15 set. */
export function countBit15(pixels: Uint8Array): number {
  if (pixels.length % 2 !== 0) {
    throw new Rgb555FormatError(`odd length ${pixels.length}`);
  }
  const src = view(pixels);
  let n = 0;
  for (let i = 0; i < pixels.length; i += 2) if (src.getUint16(i, true) & 0x8000) n++;
  return n;
}
