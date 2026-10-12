import { crc32, inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { PngEncodeError, encodePngIndexed, encodePngRgba } from './png';

interface Chunk {
  type: string;
  data: Buffer;
}

/** Splits a PNG into chunks, checking the signature, lengths and CRCs on the way. */
function readChunks(png: Buffer): Chunk[] {
  expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const chunks: Chunk[] = [];
  let pos = 8;
  while (pos < png.length) {
    const length = png.readUInt32BE(pos);
    const type = png.toString('ascii', pos + 4, pos + 8);
    const data = png.subarray(pos + 8, pos + 8 + length);
    expect(png.readUInt32BE(pos + 8 + length)).toBe(crc32(png.subarray(pos + 4, pos + 8 + length)));
    chunks.push({ type, data });
    pos += 12 + length;
  }
  expect(pos).toBe(png.length);
  return chunks;
}

function ihdr(chunks: Chunk[]) {
  const d = chunks[0]!.data;
  return {
    width: d.readUInt32BE(0),
    height: d.readUInt32BE(4),
    bitDepth: d[8],
    colorType: d[9],
    rest: [d[10], d[11], d[12]],
  };
}

/** Inflates IDAT and strips the per-row filter byte (all must be 0). */
function scanlines(chunks: Chunk[], stride: number): number[][] {
  const raw = inflateSync(
    Buffer.concat(chunks.filter((c) => c.type === 'IDAT').map((c) => c.data)),
  );
  const rows: number[][] = [];
  for (let at = 0; at < raw.length; at += stride + 1) {
    expect(raw[at]).toBe(0);
    rows.push([...raw.subarray(at + 1, at + 1 + stride)]);
  }
  return rows;
}

describe('encodePngRgba', () => {
  it('writes IHDR, IDAT and IEND with row-by-row RGBA pixels', () => {
    const rgba = Uint8Array.from([1, 2, 3, 255, 4, 5, 6, 0, 7, 8, 9, 128, 10, 11, 12, 255]);
    const chunks = readChunks(encodePngRgba(2, 2, rgba));

    expect(chunks.map((c) => c.type)).toEqual(['IHDR', 'IDAT', 'IEND']);
    expect(ihdr(chunks)).toEqual({
      width: 2,
      height: 2,
      bitDepth: 8,
      colorType: 6,
      rest: [0, 0, 0],
    });
    expect(scanlines(chunks, 8)).toEqual([
      [1, 2, 3, 255, 4, 5, 6, 0],
      [7, 8, 9, 128, 10, 11, 12, 255],
    ]);
    expect(chunks[2]!.data.length).toBe(0);
  });

  it('rejects a pixel buffer of the wrong length', () => {
    expect(() => encodePngRgba(2, 1, new Uint8Array(7))).toThrow(PngEncodeError);
  });

  it('rejects an empty or fractional size', () => {
    expect(() => encodePngRgba(0, 1, new Uint8Array(0))).toThrow(PngEncodeError);
    expect(() => encodePngRgba(1.5, 2, new Uint8Array(12))).toThrow(PngEncodeError);
  });
});

describe('encodePngIndexed', () => {
  const opaque = Uint8Array.from([10, 20, 30, 255, 40, 50, 60, 255, 70, 80, 90, 255]);

  it('writes PLTE and the indices, without tRNS for an opaque palette', () => {
    const chunks = readChunks(encodePngIndexed(3, 1, Uint8Array.from([2, 0, 1]), opaque));

    expect(chunks.map((c) => c.type)).toEqual(['IHDR', 'PLTE', 'IDAT', 'IEND']);
    expect(ihdr(chunks)).toMatchObject({ width: 3, height: 1, bitDepth: 8, colorType: 3 });
    expect([...chunks[1]!.data]).toEqual([10, 20, 30, 40, 50, 60, 70, 80, 90]);
    expect(scanlines(chunks, 3)).toEqual([[2, 0, 1]]);
  });

  it('writes tRNS up to the last non-opaque entry', () => {
    const palette = Uint8Array.from(opaque);
    palette[3] = 0; // entry 0 transparent, entries 1-2 opaque
    const chunks = readChunks(encodePngIndexed(1, 1, Uint8Array.from([0]), palette));

    expect(chunks.map((c) => c.type)).toEqual(['IHDR', 'PLTE', 'tRNS', 'IDAT', 'IEND']);
    expect([...chunks[2]!.data]).toEqual([0]);
  });

  it('accepts a full 256-colour palette', () => {
    const palette = new Uint8Array(1024).fill(255);
    const chunks = readChunks(encodePngIndexed(1, 1, Uint8Array.from([255]), palette));
    expect(chunks[1]!.data.length).toBe(768);
  });

  it('rejects an index outside the palette', () => {
    expect(() => encodePngIndexed(1, 1, Uint8Array.from([3]), opaque)).toThrow(PngEncodeError);
  });

  it('rejects a bad palette length', () => {
    expect(() => encodePngIndexed(1, 1, Uint8Array.from([0]), new Uint8Array(0))).toThrow(
      PngEncodeError,
    );
    expect(() => encodePngIndexed(1, 1, Uint8Array.from([0]), new Uint8Array(1028))).toThrow(
      PngEncodeError,
    );
    expect(() => encodePngIndexed(1, 1, Uint8Array.from([0]), new Uint8Array(6))).toThrow(
      PngEncodeError,
    );
  });

  it('rejects an index buffer of the wrong length', () => {
    expect(() => encodePngIndexed(2, 2, new Uint8Array(3), opaque)).toThrow(PngEncodeError);
  });
});
