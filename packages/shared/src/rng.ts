// Serializable PRNG state. The only source of randomness is GameState.rngState.

export type RngState =
  /** Production generator; state is a uint32. */
  | { kind: 'mulberry32'; state: number }
  /** Test-only fixed sequence of nextInt results; created only by testing.ts. */
  | { kind: 'scripted'; values: readonly number[] };
