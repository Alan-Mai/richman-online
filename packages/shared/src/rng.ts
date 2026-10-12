// Serializable PRNG state. The only source of randomness is GameState.rngState.
// Every random draw (dice, later card draws) goes through nextInt.

export type RngState =
  /** Production generator; state is a uint32. */
  | { kind: 'mulberry32'; state: number }
  /** Test-only fixed sequence of nextInt results; created only by testing.ts. */
  | { kind: 'scripted'; values: readonly number[] };

const UINT32_RANGE = 2 ** 32;

export function isUint32(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < UINT32_RANGE;
}

export function createRng(seed: number): RngState {
  if (!isUint32(seed)) {
    throw new RangeError(`RNG seed must be a uint32, got ${String(seed)}`);
  }
  return { kind: 'mulberry32', state: seed };
}

/** One raw mulberry32 output. Not available for scripted states. */
export function nextUint32(rng: RngState): [value: number, rng: RngState] {
  if (rng.kind === 'scripted') {
    throw new Error('scripted RNG only supports nextInt');
  }
  const state = (rng.state + 0x6d2b79f5) >>> 0;
  let t = Math.imul(state ^ (state >>> 15), state | 1);
  t = (t + Math.imul(t ^ (t >>> 7), t | 61)) ^ t;
  return [(t ^ (t >>> 14)) >>> 0, { kind: 'mulberry32', state }];
}

/** Uniform integer in [0, n), using rejection sampling to avoid modulo bias. */
export function nextInt(rng: RngState, n: number): [value: number, rng: RngState] {
  if (!Number.isInteger(n) || n < 1 || n > UINT32_RANGE) {
    throw new RangeError(`nextInt range must be an integer in [1, 2^32], got ${n}`);
  }
  if (rng.kind === 'scripted') {
    const [value, ...rest] = rng.values;
    if (value === undefined) {
      throw new Error('scripted RNG exhausted');
    }
    if (value >= n) {
      throw new RangeError(`scripted value ${value} is out of range [0, ${n})`);
    }
    return [value, { kind: 'scripted', values: rest }];
  }
  const limit = UINT32_RANGE - (UINT32_RANGE % n);
  let current: RngState = rng;
  for (;;) {
    const [raw, next] = nextUint32(current);
    current = next;
    if (raw < limit) {
      return [raw % n, current];
    }
  }
}

export type ParseRngResult =
  { ok: true; rng: RngState } | { ok: false; reason: 'scriptedNotAllowed' | 'invalid' };

/** Validates an RNG state from outside the engine (saves, setup). Scripted states are refused. */
export function parseRngState(raw: unknown): ParseRngResult {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, reason: 'invalid' };
  }
  const record = raw as Record<string, unknown>;
  if (record.kind === 'scripted') {
    return { ok: false, reason: 'scriptedNotAllowed' };
  }
  if (record.kind !== 'mulberry32' || !isUint32(record.state)) {
    return { ok: false, reason: 'invalid' };
  }
  return { ok: true, rng: { kind: 'mulberry32', state: record.state } };
}
