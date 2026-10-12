// Test-only helpers. Not exported from index.ts; the only place that creates scripted RNG states.
import type { Action } from './actions';
import type { Board, TileDef } from './board';
import { DEFAULT_RULE_CONFIG, type RuleConfig } from './config';
import { applyAction, createGame } from './engine';
import type { GameEvent } from './events';
import type { PlayerId, TileIndex } from './ids';
import { TEST_LOOP_BOARD } from './maps/test-loop';
import type { RngState } from './rng';
import type { GameState, PlayerState, TileState, TurnState } from './state';

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

export const TEST_SEED = 20261012;

export interface TestGameOptions {
  config?: Partial<RuleConfig>;
  board?: Board;
  /** Players are p1..pN in seat order. Defaults to 2. */
  playerCount?: number;
  seed?: number;
}

/** A started game on TEST_LOOP_BOARD (unless given); throws if the setup is invalid. */
export function newTestGame(options: TestGameOptions = {}): GameState {
  const count = options.playerCount ?? 2;
  const result = createGame({
    config: { ...DEFAULT_RULE_CONFIG, ...options.config },
    board: options.board ?? TEST_LOOP_BOARD,
    players: Array.from({ length: count }, (_, i) => ({ id: `p${i + 1}`, name: `玩家${i + 1}` })),
    seed: options.seed ?? TEST_SEED,
  });
  if (!result.ok) {
    throw new Error(`invalid test game: ${JSON.stringify(result.errors)}`);
  }
  return result.state;
}

/**
 * A loop 0 -> 1 -> ... -> 0 starting at tile 0. Each entry is a property price, or null for a
 * blank tile. Names are placeholders.
 */
export function loopBoard(spec: readonly (number | null)[]): Board {
  const tiles = spec.map((price, i): TileDef => {
    const base = { name: `T${i}`, next: [(i + 1) % spec.length], pos: { x: i, y: 0 } };
    return price === null ? { kind: 'blank', ...base } : { kind: 'property', price, ...base };
  });
  return { id: 'test', name: 'test', tiles, start: 0 };
}

export function getPlayer(state: GameState, id: PlayerId): PlayerState {
  const player = state.players.find((p) => p.id === id);
  if (player === undefined) throw new Error(`no player ${id}`);
  return player;
}

export function patchPlayer(
  state: GameState,
  id: PlayerId,
  patch: Partial<PlayerState>,
): GameState {
  getPlayer(state, id);
  return {
    ...state,
    players: state.players.map((p) => (p.id === id ? { ...p, ...patch } : p)),
  };
}

export function patchTile(
  state: GameState,
  index: TileIndex,
  patch: Partial<TileState>,
): GameState {
  return {
    ...state,
    tiles: state.tiles.map((t, i) => (i === index ? { ...t, ...patch } : t)),
  };
}

export function patchTurn(state: GameState, patch: Partial<TurnState>): GameState {
  return { ...state, turn: { ...state.turn, ...patch } };
}

/** applyAction that throws on rejection, for tests that only care about the success path. */
export function applyOk(
  state: GameState,
  action: Action,
): { state: GameState; events: GameEvent[] } {
  const result = applyAction(state, action);
  if (!result.ok) {
    throw new Error(`action rejected: ${JSON.stringify(result.error)}`);
  }
  return { state: result.state, events: result.events };
}
