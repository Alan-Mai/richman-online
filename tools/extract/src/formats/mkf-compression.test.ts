import { describe, expect, it } from 'vitest';
import {
  AdaptiveHuffmanTree,
  MkfCompressionError,
  buildPositionPrefixTable,
  decompressMkf,
} from './mkf-compression';

/** Packs bits into bytes, first bit at bit 0 of the first byte. */
class BitWriter {
  private readonly bits: number[] = [];
  push(bit: number): void {
    this.bits.push(bit);
  }
  /** Writes `n` bits of `value`, bit 0 first. */
  value(value: number, n: number): void {
    for (let i = 0; i < n; i++) this.push((value >> i) & 1);
  }
  bytes(): Uint8Array {
    const out = new Uint8Array(Math.ceil(this.bits.length / 8));
    this.bits.forEach((b, i) => (out[i >> 3]! |= b << (i & 7)));
    return out;
  }
}

type Token =
  { kind: 'literal'; byte: number } | { kind: 'match'; length: number; position: number };

const table = buildPositionPrefixTable();

/** Test-only encoder for hand-chosen tokens; `end` appends the end marker (position 4095). */
function encode(tokens: Token[], end = true): Uint8Array {
  const w = new BitWriter();
  const tree = new AdaptiveHuffmanTree();
  const symbol = (s: number) => {
    for (const b of tree.codeOf(s)) w.push(b);
    tree.update(s);
  };
  const position = (p: number) => {
    const upper = p >> 6;
    const index = table.upper.findIndex((u) => u === upper);
    const len = table.length[index]!;
    w.value(index & ((1 << len) - 1), len);
    w.value(p & 0x3f, 6);
  };
  for (const t of tokens) {
    if (t.kind === 'literal') symbol(t.byte);
    else {
      symbol(256 + t.length - 3);
      position(t.position);
    }
  }
  if (end) {
    symbol(256);
    position(0xfff);
  }
  return w.bytes();
}

const lit = (bytes: number[]): Token[] => bytes.map((byte) => ({ kind: 'literal', byte }));

function expectError(input: Uint8Array, rawSize: number, code: MkfCompressionError['code']) {
  let caught: unknown;
  try {
    decompressMkf(input, rawSize);
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(MkfCompressionError);
  expect((caught as MkfCompressionError).code).toBe(code);
}

describe('position prefix table', () => {
  it('has 1, 3, 8, 12, 24, 16 codes of lengths 3-8 covering all 64 upper values', () => {
    const codesPerLength = new Map<number, Set<number>>();
    for (let i = 0; i < 256; i++) {
      const len = table.length[i]!;
      const set = codesPerLength.get(len) ?? new Set();
      set.add(table.upper[i]!);
      codesPerLength.set(len, set);
    }
    expect([...codesPerLength].map(([l, s]) => [l, s.size]).sort((a, b) => a[0]! - b[0]!)).toEqual([
      [3, 1],
      [4, 3],
      [5, 8],
      [6, 12],
      [7, 24],
      [8, 16],
    ]);
    expect(new Set(table.upper).size).toBe(64);
  });

  it('assigns upper values in order of increasing prefix length', () => {
    let lastLength = 0;
    for (let u = 0; u < 64; u++) {
      const len = table.length[table.upper.indexOf(u)]!;
      expect(len).toBeGreaterThanOrEqual(lastLength);
      lastLength = len;
    }
  });

  it('is prefix-free: each entry depends only on its own low `length` bits', () => {
    for (let i = 0; i < 256; i++) {
      const len = table.length[i]!;
      const key = i & ((1 << len) - 1);
      expect(table.length[key]).toBe(len);
      expect(table.upper[key]).toBe(table.upper[i]);
    }
  });

  it('gives the shortest prefix (upper 0) to keys whose 3 low bits are all ones', () => {
    expect(table.length[0b111]).toBe(3);
    expect(table.upper[0b111]).toBe(0);
  });
});

describe('AdaptiveHuffmanTree', () => {
  it('starts with 9-bit literal codes equal to 382 + byte for small bytes', () => {
    const tree = new AdaptiveHuffmanTree();
    for (const v of [0, 1, 65, 129]) {
      expect(tree.codeOf(v).join('')).toBe((382 + v).toString(2));
    }
  });

  it('decodes what codeOf produces, across updates', () => {
    const tree = new AdaptiveHuffmanTree();
    const mirror = new AdaptiveHuffmanTree();
    for (const s of [5, 5, 300, 7, 5, 320, 0, 255]) {
      const bits = tree.codeOf(s);
      let i = 0;
      expect(mirror.decode(() => bits[i++]!)).toBe(s);
      expect(i).toBe(bits.length);
      tree.update(s);
      mirror.update(s);
    }
  });

  it('shortens the code of a frequent symbol', () => {
    const tree = new AdaptiveHuffmanTree();
    const before = tree.codeOf(42).length;
    for (let i = 0; i < 50; i++) tree.update(42);
    expect(tree.codeOf(42).length).toBeLessThan(before);
  });
});

describe('decompressMkf', () => {
  it('reads a hand-assembled initial literal code and a 9-bit position field', () => {
    // Literal 0x41 with its initial code (382 + byte, root bit first), then a length-3 match
    // whose position is prefix 0b111 (upper 0) + low bits 63: it reaches before the start.
    const w = new BitWriter();
    for (const ch of (382 + 0x41).toString(2)) w.push(Number(ch));
    const tree = new AdaptiveHuffmanTree();
    tree.update(0x41);
    for (const b of tree.codeOf(256)) w.push(b);
    w.value(0b111, 3);
    w.value(63, 6);
    expectError(w.bytes(), 4, 'ref-before-start');
  });

  it('round-trips literals', () => {
    const data = [0x53, 0x50, 0x52, 0x00, 0x14, 0, 0, 0];
    expect([...decompressMkf(encode(lit(data)), data.length)]).toEqual(data);
  });

  it('copies overlapping matches one byte at a time', () => {
    const input = encode([...lit([1, 2]), { kind: 'match', length: 7, position: 1 }]);
    expect([...decompressMkf(input, 9)]).toEqual([1, 2, 1, 2, 1, 2, 1, 2, 1]);
  });

  it('supports the longest match (67) and the farthest position (4094)', () => {
    const head = Array.from({ length: 4095 }, (_, i) => (i * 7) & 0xff);
    const input = encode([...lit(head), { kind: 'match', length: 67, position: 4094 }]);
    const out = decompressMkf(input, 4095 + 67);
    expect([...out.subarray(4095)]).toEqual(head.slice(0, 67));
  });

  it('keeps decoding after the frequency cap halves the tree', () => {
    const data = Array.from({ length: 40000 }, (_, i) => (i % 3 === 0 ? 7 : i & 0xff));
    expect([...decompressMkf(encode(lit(data)), data.length)]).toEqual(data);
  });

  it('decodes an empty stream that only holds the end marker', () => {
    expect(decompressMkf(encode([]), 0).length).toBe(0);
  });

  it('rejects a stream without the end marker', () => {
    expectError(encode(lit([1, 2, 3]), false), 3, 'input-exhausted');
  });

  it('rejects output shorter than rawSize', () => {
    expectError(encode(lit([1, 2, 3])), 4, 'short-output');
  });

  it('rejects output longer than rawSize', () => {
    expectError(encode(lit([1, 2, 3])), 2, 'output-overrun');
    expectError(
      encode([...lit([1]), { kind: 'match', length: 5, position: 0 }]),
      4,
      'output-overrun',
    );
  });

  it('rejects references before the start of the output', () => {
    expectError(
      encode([...lit([1]), { kind: 'match', length: 3, position: 1 }]),
      4,
      'ref-before-start',
    );
  });

  it('rejects bytes left after the end marker', () => {
    const input = encode(lit([1, 2, 3]));
    expectError(Uint8Array.from([...input, 0]), 3, 'trailing-input');
  });
});
