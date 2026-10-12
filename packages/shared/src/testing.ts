// Test-only helpers. Not exported from index.ts; the only place that creates scripted RNG states.
import type { RngState } from './rng';
import type { GameState } from './state';

/** An RNG whose nextInt calls return `values` in order (each must be < the requested range). */
export function scriptedRng(values: readonly number[]): RngState {
  for (const value of values) {
    if (!Number.isInteger(value) || value < 0) {
      throw new RangeError(`scripted value must be a non-negative integer, got ${value}`);
    }
  }
  return { kind: 'scripted', values: [...values] };
}

/** Replaces rngState so the next dice show `faces` (1-based) in order. */
export function withFixedDice(state: GameState, faces: readonly number[]): GameState {
  const { diceFaces } = state.config;
  for (const face of faces) {
    if (!Number.isInteger(face) || face < 1 || face > diceFaces) {
      throw new RangeError(`die face must be in 1..${diceFaces}, got ${face}`);
    }
  }
  return { ...state, rngState: scriptedRng(faces.map((face) => face - 1)) };
}
