import { describe, expect, it } from 'vitest';
import { EntropyAccumulator, shannonEntropy } from './entropy';

function bytes(length: number, at: (i: number) => number): Uint8Array {
  return Uint8Array.from({ length }, (_, i) => at(i));
}

function analyze(chunks: Uint8Array[], blockSize = 4) {
  const acc = new EntropyAccumulator(blockSize);
  for (const c of chunks) acc.push(c);
  return acc.result();
}

describe('shannonEntropy', () => {
  it('is 0 for a single repeated value', () => {
    const counts = new Array<number>(256).fill(0);
    counts[0] = 100;
    expect(shannonEntropy(counts, 100)).toBe(0);
  });

  it('is 8 when all 256 values are equally likely', () => {
    expect(shannonEntropy(new Array<number>(256).fill(1), 256)).toBeCloseTo(8, 10);
  });

  it('is 1 for two equally likely values', () => {
    const counts = new Array<number>(256).fill(0);
    counts[1] = 5;
    counts[200] = 5;
    expect(shannonEntropy(counts, 10)).toBeCloseTo(1, 10);
  });

  it('is 0 for no data', () => {
    expect(shannonEntropy(new Array<number>(256).fill(0), 0)).toBe(0);
  });
});

describe('EntropyAccumulator', () => {
  it('reports no blocks for an empty input', () => {
    expect(analyze([])).toEqual({
      size: 0,
      head: new Uint8Array(0),
      entropy: 0,
      blockEntropyMin: null,
      blockEntropyMax: null,
    });
  });

  it('keeps only the first 16 bytes as head across chunks', () => {
    const r = analyze([bytes(10, (i) => i), bytes(10, (i) => 10 + i)], 64);
    expect(Array.from(r.head)).toEqual(Array.from({ length: 16 }, (_, i) => i));
    expect(r.size).toBe(20);
  });

  it('measures min/max over full blocks regardless of chunk boundaries', () => {
    // Block 1: [0,0,0,0] -> 0 bits. Block 2: [0,1,2,3] -> 2 bits. Chunks split mid-block.
    const data = [0, 0, 0, 0, 0, 1, 2, 3];
    const r = analyze([Uint8Array.from(data.slice(0, 3)), Uint8Array.from(data.slice(3))]);
    expect(r.blockEntropyMin).toBe(0);
    expect(r.blockEntropyMax).toBeCloseTo(2, 10);
  });

  it('ignores a trailing partial block when full blocks exist', () => {
    // Full block of zeros, then a 2-byte tail with 1 bit of entropy.
    const r = analyze([Uint8Array.from([0, 0, 0, 0, 7, 9])]);
    expect(r.blockEntropyMin).toBe(0);
    expect(r.blockEntropyMax).toBe(0);
  });

  it('uses the partial block when the input is smaller than one block', () => {
    const r = analyze([Uint8Array.from([7, 9])]);
    expect(r.blockEntropyMin).toBeCloseTo(1, 10);
    expect(r.blockEntropyMax).toBeCloseTo(1, 10);
  });

  it('computes whole-input entropy across all bytes', () => {
    const r = analyze([bytes(512, (i) => i % 256)], 64);
    expect(r.entropy).toBeCloseTo(8, 10);
  });
});
