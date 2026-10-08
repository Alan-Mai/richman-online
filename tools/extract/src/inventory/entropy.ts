export const HEAD_BYTES = 16;

/** Shannon entropy in bits per byte (0..8) from a 256-entry histogram. */
export function shannonEntropy(counts: ArrayLike<number>, total: number): number {
  if (total === 0) return 0;
  let h = 0;
  for (let i = 0; i < counts.length; i++) {
    const c = counts[i] ?? 0;
    if (c === 0) continue;
    const p = c / total;
    h -= p * Math.log2(p);
  }
  return h;
}

export interface EntropyResult {
  size: number;
  head: Uint8Array;
  entropy: number;
  /** Over full blocks only; a trailing partial block counts only if it is the sole block. */
  blockEntropyMin: number | null;
  blockEntropyMax: number | null;
}

/**
 * Streams bytes once and collects the head, whole-input entropy and per-block entropy range.
 * Chunk boundaries do not need to align with blocks.
 */
export class EntropyAccumulator {
  private readonly total = new Float64Array(256);
  private readonly block = new Float64Array(256);
  private readonly head = new Uint8Array(HEAD_BYTES);
  private headLength = 0;
  private size = 0;
  private blockFill = 0;
  private min: number | null = null;
  private max: number | null = null;

  constructor(private readonly blockSize: number) {}

  push(chunk: Uint8Array): void {
    for (const b of chunk) {
      if (this.headLength < HEAD_BYTES) this.head[this.headLength++] = b;
      this.total[b]! += 1;
      this.block[b]! += 1;
      this.size += 1;
      if (++this.blockFill === this.blockSize) this.closeBlock();
    }
  }

  result(): EntropyResult {
    let { min, max } = this;
    if (min === null && this.blockFill > 0) {
      min = max = shannonEntropy(this.block, this.blockFill);
    }
    return {
      size: this.size,
      head: this.head.slice(0, this.headLength),
      entropy: shannonEntropy(this.total, this.size),
      blockEntropyMin: min,
      blockEntropyMax: max,
    };
  }

  private closeBlock(): void {
    const h = shannonEntropy(this.block, this.blockFill);
    this.min = this.min === null ? h : Math.min(this.min, h);
    this.max = this.max === null ? h : Math.max(this.max, h);
    this.block.fill(0);
    this.blockFill = 0;
  }
}
