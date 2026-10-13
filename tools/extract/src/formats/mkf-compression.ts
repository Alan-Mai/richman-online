// Compression of MKF entries whose rawSize differs from storedSize
// (see docs/ASSET_FORMATS.md, "MKF 壓縮（LZ + 動態 Huffman）").
//
// LZ77 with an adaptive Huffman coder for literals/lengths, in the family of LZHUF:
// - Bits are taken from each byte starting at the least significant bit; Huffman codes are
//   walked one bit at a time from the root, other fields are assembled first-bit-is-bit-0.
// - 321 symbols: 0-255 literal bytes, 256-320 match lengths 3-67.
// - A match position p is a variable-length prefix (3-8 bits, upper 6 bits of p) plus 6 low bits;
//   the copy source is p + 1 bytes back in the output. p = 4095 ends the stream.

const SYMBOLS = 321;
const NODES = SYMBOLS * 2 - 1;
const ROOT = NODES - 1;
const FREQ_CAP = 0x8000;
const MIN_MATCH = 3;
const LOW_BITS = 6;
const END_POSITION = 0xfff;

export type MkfCompressionErrorCode =
  'input-exhausted' | 'output-overrun' | 'ref-before-start' | 'short-output' | 'trailing-input';

export class MkfCompressionError extends Error {
  constructor(
    readonly code: MkfCompressionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'MkfCompressionError';
  }
}

/**
 * Position prefix codes: for each length 3-8, how many codes it has. Codes are assigned
 * canonically (most significant bit first, ascending), then each code's bits are inverted and
 * reversed into a key read first-bit-is-bit-0. Upper values 0-63 go to lengths in ascending
 * order; within one length, the smallest upper value goes to the largest key.
 */
const PREFIX_CODE_COUNTS: readonly (readonly [length: number, count: number])[] = [
  [3, 1],
  [4, 3],
  [5, 8],
  [6, 12],
  [7, 24],
  [8, 16],
];

export interface PositionPrefixTable {
  /** Indexed by the next 8 bits (first bit is bit 0): prefix length in bits. */
  length: Uint8Array;
  /** Indexed like `length`: upper 6 bits of the position. */
  upper: Uint8Array;
}

export function buildPositionPrefixTable(): PositionPrefixTable {
  const length = new Uint8Array(256);
  const upper = new Uint8Array(256);
  let code = 0;
  let prevLength = PREFIX_CODE_COUNTS[0]![0];
  let nextUpper = 0;
  for (const [len, count] of PREFIX_CODE_COUNTS) {
    code <<= len - prevLength;
    prevLength = len;
    const keys: number[] = [];
    for (let k = 0; k < count; k++, code++) {
      const inverted = ~code & ((1 << len) - 1);
      let key = 0;
      for (let b = 0; b < len; b++) if (inverted & (1 << (len - 1 - b))) key |= 1 << b;
      keys.push(key);
    }
    keys.sort((a, b) => b - a);
    for (const key of keys) {
      for (let idx = key; idx < 256; idx += 1 << len) {
        length[idx] = len;
        upper[idx] = nextUpper;
      }
      nextUpper++;
    }
  }
  return { length, upper };
}

const PREFIX = buildPositionPrefixTable();

/**
 * Adaptive Huffman tree over the 321 symbols. Nodes are kept sorted by frequency; a node's
 * `child` is its first child (the second is child + 1), or NODES + symbol for a leaf.
 */
export class AdaptiveHuffmanTree {
  private readonly freq = new Uint32Array(NODES + 1);
  private readonly child = new Int32Array(NODES);
  private readonly parent = new Int32Array(NODES + SYMBOLS);

  constructor() {
    for (let s = 0; s < SYMBOLS; s++) {
      this.freq[s] = 1;
      this.child[s] = s + NODES;
      this.parent[s + NODES] = s;
    }
    for (let i = 0, j = SYMBOLS; j <= ROOT; i += 2, j++) {
      this.freq[j] = this.freq[i]! + this.freq[i + 1]!;
      this.child[j] = i;
      this.parent[i] = this.parent[i + 1] = j;
    }
    this.freq[NODES] = 0xffff; // sentinel above every real frequency
    this.parent[ROOT] = 0;
  }

  /** Walks from the root, one bit per level (0 = first child), and returns the symbol. */
  decode(readBit: () => number): number {
    let node = this.child[ROOT]!;
    while (node < NODES) node = this.child[node + readBit()]!;
    return node - NODES;
  }

  /** The bits `decode` would read for `symbol`, root first. */
  codeOf(symbol: number): number[] {
    const bits: number[] = [];
    for (let node = this.parent[symbol + NODES]!; node !== ROOT;) {
      const up = this.parent[node]!;
      bits.push(node === this.child[up] ? 0 : 1);
      node = up;
    }
    return bits.reverse();
  }

  /** Counts one more occurrence of `symbol`, halving all frequencies first at the cap. */
  update(symbol: number): void {
    if (this.freq[ROOT] === FREQ_CAP) this.rescale();
    this.increment(symbol);
  }

  /** Makes every frequency even by counting odd symbols once more, then halves all of them. */
  private rescale(): void {
    for (let s = 0; s < SYMBOLS; s++) {
      if (this.freq[this.parent[s + NODES]!]! & 1) this.increment(s);
    }
    for (let i = 0; i < NODES; i++) this.freq[i] = this.freq[i]! >>> 1;
  }

  private increment(symbol: number): void {
    const { freq, child, parent } = this;
    let node = parent[symbol + NODES]!;
    do {
      const f = ++freq[node]!;
      let swap = node + 1;
      if (f > freq[swap]!) {
        // Move the node past every node whose frequency is now lower, keeping the order sorted.
        while (f > freq[++swap]!);
        swap--;
        freq[node] = freq[swap]!;
        freq[swap] = f;
        const a = child[node]!;
        parent[a] = swap;
        if (a < NODES) parent[a + 1] = swap;
        const b = child[swap]!;
        child[swap] = a;
        parent[b] = node;
        if (b < NODES) parent[b + 1] = node;
        child[node] = b;
        node = swap;
      }
      node = parent[node]!;
    } while (node !== 0);
  }
}

/**
 * Decompresses one MKF entry payload into exactly `rawSize` bytes. Strict: the stream must end
 * with the end marker exactly at `rawSize`, never refer before the start of the output, and use
 * every input byte (only the unused bits of the last byte may remain).
 */
export function decompressMkf(input: Uint8Array, rawSize: number): Uint8Array {
  const totalBits = input.length * 8;
  let pos = 0;
  const bitAt = (p: number) => ((input[p >> 3] ?? 0) >> (p & 7)) & 1;
  const readBit = () => {
    if (pos >= totalBits) {
      throw new MkfCompressionError('input-exhausted', `input ended at bit ${pos}`);
    }
    return bitAt(pos++);
  };
  const readBits = (n: number) => {
    let v = 0;
    for (let i = 0; i < n; i++) v |= readBit() << i;
    return v;
  };

  const tree = new AdaptiveHuffmanTree();
  const out = new Uint8Array(rawSize);
  let o = 0;
  for (;;) {
    const symbol = tree.decode(readBit);
    tree.update(symbol);
    if (symbol < 256) {
      if (o >= rawSize) {
        throw new MkfCompressionError('output-overrun', `literal past ${rawSize} bytes`);
      }
      out[o++] = symbol;
      continue;
    }

    // The prefix is looked up from the next 8 bits, which may extend past the input.
    let index = 0;
    for (let i = 0; i < 8; i++) index |= bitAt(pos + i) << i;
    readBits(PREFIX.length[index]!);
    const position = (PREFIX.upper[index]! << LOW_BITS) | readBits(LOW_BITS);
    if (position === END_POSITION) break;

    const length = symbol - 256 + MIN_MATCH;
    const from = o - 1 - position;
    if (from < 0) {
      throw new MkfCompressionError('ref-before-start', `match at ${o} reaches back to ${from}`);
    }
    if (o + length > rawSize) {
      throw new MkfCompressionError('output-overrun', `match at ${o} past ${rawSize} bytes`);
    }
    for (let k = 0; k < length; k++) out[o++] = out[from + k]!;
  }

  if (o !== rawSize) {
    throw new MkfCompressionError('short-output', `ended at ${o} of ${rawSize} bytes`);
  }
  const usedBytes = Math.ceil(pos / 8);
  if (usedBytes !== input.length) {
    throw new MkfCompressionError(
      'trailing-input',
      `stream ended after ${usedBytes} of ${input.length} bytes`,
    );
  }
  return out;
}
