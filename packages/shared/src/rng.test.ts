import { describe, expect, it } from 'vitest';
import { DEFAULT_RULE_CONFIG } from './config';
import { createRng, nextInt, nextUint32, parseRngState, type RngState } from './rng';
import type { GameState } from './state';
import { scriptedRng, withFixedDice } from './testing';

function draw(rng: RngState, n: number, count: number): number[] {
  const values: number[] = [];
  let current = rng;
  for (let i = 0; i < count; i++) {
    const [value, next] = nextInt(current, n);
    values.push(value);
    current = next;
  }
  return values;
}

describe('createRng', () => {
  it('accepts any uint32 seed', () => {
    expect(createRng(0)).toEqual({ kind: 'mulberry32', state: 0 });
    expect(createRng(0xffffffff)).toEqual({ kind: 'mulberry32', state: 0xffffffff });
  });

  it('rejects seeds that are not uint32', () => {
    for (const seed of [-1, 1.5, 2 ** 32, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => createRng(seed)).toThrow(RangeError);
    }
  });
});

describe('nextUint32 (mulberry32)', () => {
  it('matches the reference mulberry32 output', () => {
    // Reference values from the published mulberry32 algorithm for seed 1.
    let rng = createRng(1);
    const out: number[] = [];
    for (let i = 0; i < 3; i++) {
      const [value, next] = nextUint32(rng);
      out.push(value);
      rng = next;
    }
    expect(out).toEqual([2693262067, 11749833, 2265367787]);
  });

  it('does not mutate the input state', () => {
    const rng = createRng(42);
    const snapshot = { ...rng };
    nextUint32(rng);
    expect(rng).toEqual(snapshot);
  });
});

describe('nextInt', () => {
  it('is reproducible for the same seed', () => {
    expect(draw(createRng(123), 6, 50)).toEqual(draw(createRng(123), 6, 50));
    expect(draw(createRng(123), 6, 50)).not.toEqual(draw(createRng(124), 6, 50));
  });

  it('continues the same sequence after a JSON round trip', () => {
    let rng = createRng(7);
    for (let i = 0; i < 10; i++) rng = nextInt(rng, 6)[1];
    const restored = JSON.parse(JSON.stringify(rng)) as RngState;
    expect(draw(restored, 6, 20)).toEqual(draw(rng, 6, 20));
  });

  it('stays within [0, n) and covers every value', () => {
    const values = draw(createRng(99), 6, 6000);
    const counts = [0, 0, 0, 0, 0, 0];
    for (const v of values) {
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(6);
      counts[v] = (counts[v] ?? 0) + 1;
    }
    for (const c of counts) {
      // Expected 1000 each; a loose bound only catches gross bias.
      expect(c).toBeGreaterThan(850);
      expect(c).toBeLessThan(1150);
    }
  });

  it('handles the range edges', () => {
    expect(draw(createRng(5), 1, 10)).toEqual(Array<number>(10).fill(0));
    const [big] = nextInt(createRng(5), 2 ** 32);
    expect(big).toBeGreaterThanOrEqual(0);
    expect(big).toBeLessThan(2 ** 32);
  });

  it('rejects draws from the biased tail', () => {
    // n = 2^31 + 1: the unbiased limit is 2^31 + 1, so roughly half of all raw draws are
    // rejected. The result must still be in range and consume extra state when rejecting.
    const n = 2 ** 31 + 1;
    let rng = createRng(2024);
    let rejectedSomewhere = false;
    for (let i = 0; i < 20; i++) {
      const [raw, afterOne] = nextUint32(rng);
      const [value, after] = nextInt(rng, n);
      expect(value).toBeLessThan(n);
      if (raw >= n) {
        rejectedSomewhere = true;
        expect(after).not.toEqual(afterOne);
      } else {
        expect(value).toBe(raw);
        expect(after).toEqual(afterOne);
      }
      rng = after;
    }
    expect(rejectedSomewhere).toBe(true);
  });

  it('rejects an invalid range', () => {
    for (const n of [0, -1, 1.5, 2 ** 32 + 1, Number.NaN]) {
      expect(() => nextInt(createRng(1), n)).toThrow(RangeError);
    }
  });
});

describe('scripted RNG', () => {
  it('returns the scripted values in order', () => {
    const rng = scriptedRng([2, 0, 5]);
    expect(draw(rng, 6, 3)).toEqual([2, 0, 5]);
  });

  it('throws when exhausted or out of range', () => {
    expect(() => nextInt(scriptedRng([]), 6)).toThrow(/exhausted/);
    expect(() => nextInt(scriptedRng([6]), 6)).toThrow(RangeError);
    expect(() => nextUint32(scriptedRng([1]))).toThrow(/scripted/);
  });

  it('rejects non-integer values at creation', () => {
    expect(() => scriptedRng([1.5])).toThrow(RangeError);
    expect(() => scriptedRng([-1])).toThrow(RangeError);
  });
});

describe('withFixedDice', () => {
  const state = {
    config: DEFAULT_RULE_CONFIG,
    rngState: createRng(1),
  } as unknown as GameState;

  it('replaces rngState with the faces shifted to 0-based draws', () => {
    const fixed = withFixedDice(state, [3, 5]);
    expect(fixed.rngState).toEqual({ kind: 'scripted', values: [2, 4] });
    expect(state.rngState).toEqual(createRng(1));
    expect(draw(fixed.rngState, DEFAULT_RULE_CONFIG.diceFaces, 2).map((v) => v + 1)).toEqual([
      3, 5,
    ]);
  });

  it('rejects faces outside 1..diceFaces', () => {
    expect(() => withFixedDice(state, [0])).toThrow(RangeError);
    expect(() => withFixedDice(state, [7])).toThrow(RangeError);
  });
});

describe('parseRngState', () => {
  it('accepts a mulberry32 state', () => {
    expect(parseRngState({ kind: 'mulberry32', state: 123 })).toEqual({
      ok: true,
      rng: { kind: 'mulberry32', state: 123 },
    });
  });

  it('drops unknown fields', () => {
    expect(parseRngState({ kind: 'mulberry32', state: 1, extra: true })).toEqual({
      ok: true,
      rng: { kind: 'mulberry32', state: 1 },
    });
  });

  it('refuses scripted states from outside', () => {
    expect(parseRngState({ kind: 'scripted', values: [1, 2] })).toEqual({
      ok: false,
      reason: 'scriptedNotAllowed',
    });
  });

  it('refuses malformed input', () => {
    for (const raw of [
      null,
      undefined,
      42,
      'mulberry32',
      [],
      {},
      { kind: 'mulberry32' },
      { kind: 'mulberry32', state: -1 },
      { kind: 'mulberry32', state: 2 ** 32 },
      { kind: 'mulberry32', state: 1.5 },
      { kind: 'mulberry32', state: '1' },
      { kind: 'xoshiro', state: 1 },
    ]) {
      expect(parseRngState(raw)).toEqual({ ok: false, reason: 'invalid' });
    }
  });
});
