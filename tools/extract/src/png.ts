// Minimal PNG encoder built on node:zlib (no native dependencies).
// Writes 8-bit truecolour+alpha (colour type 6) or 8-bit indexed (colour type 3) images,
// one IDAT chunk, filter type 0 (None) on every row.
import { crc32, deflateSync } from 'node:zlib';

const SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const COLOR_INDEXED = 3;
const COLOR_RGBA = 6;

export class PngEncodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PngEncodeError';
  }
}

function chunk(type: string, data: Uint8Array): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  out.set(data, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function checkSize(width: number, height: number): void {
  const ok = (v: number) => Number.isInteger(v) && v >= 1 && v <= 0x7fffffff;
  if (!ok(width) || !ok(height)) throw new PngEncodeError(`invalid size ${width}x${height}`);
}

function encode(
  width: number,
  height: number,
  colorType: number,
  bytesPerPixel: number,
  pixels: Uint8Array,
  extra: Buffer[],
): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = colorType;
  // compression, filter and interlace methods stay 0.

  const stride = width * bytesPerPixel;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw.set(pixels.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    ...extra,
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', new Uint8Array()),
  ]);
}

/** Encodes width * height RGBA8888 pixels, row by row. */
export function encodePngRgba(width: number, height: number, rgba: Uint8Array): Buffer {
  checkSize(width, height);
  if (rgba.length !== 4 * width * height) {
    throw new PngEncodeError(`${rgba.length} bytes for ${width}x${height} RGBA pixels`);
  }
  return encode(width, height, COLOR_RGBA, 4, rgba, []);
}

/**
 * Encodes width * height palette indices with a palette of 1-256 RGBA8888 entries.
 * Alpha is written as a tRNS chunk only when some entry is not fully opaque.
 */
export function encodePngIndexed(
  width: number,
  height: number,
  indices: Uint8Array,
  paletteRgba: Uint8Array,
): Buffer {
  checkSize(width, height);
  if (indices.length !== width * height) {
    throw new PngEncodeError(`${indices.length} indices for ${width}x${height} pixels`);
  }
  const colors = paletteRgba.length / 4;
  if (!Number.isInteger(colors) || colors < 1 || colors > 256) {
    throw new PngEncodeError(`palette of ${paletteRgba.length} bytes`);
  }
  const max = indices.reduce((m, v) => Math.max(m, v), 0);
  if (max >= colors) {
    throw new PngEncodeError(`index ${max} outside a ${colors}-colour palette`);
  }

  const plte = Buffer.alloc(3 * colors);
  const alpha = Buffer.alloc(colors);
  for (let i = 0; i < colors; i++) {
    plte.set(paletteRgba.subarray(4 * i, 4 * i + 3), 3 * i);
    alpha[i] = paletteRgba[4 * i + 3]!;
  }
  // tRNS may omit trailing opaque entries.
  let alphaLength = colors;
  while (alphaLength > 0 && alpha[alphaLength - 1] === 255) alphaLength--;
  const extra = [chunk('PLTE', plte)];
  if (alphaLength > 0) extra.push(chunk('tRNS', alpha.subarray(0, alphaLength)));
  return encode(width, height, COLOR_INDEXED, 1, indices, extra);
}
