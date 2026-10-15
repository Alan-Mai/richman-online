// Test-only helpers. Not exported from index.ts; the only place that creates scripted RNG states.
import type { Action, ActionType } from './actions';
import type { Board, PropertyTileDef, TileDef } from './board';
import { DEFAULT_RULE_CONFIG, type RuleConfig } from './config';
import { applyAction, createGame, type PlayerSetup } from './engine';
import type { GameEvent } from './events';
import type { PlayerId, TileIndex } from './ids';
import { TEST_LOOP_BOARD } from './maps/test-loop';
import { PROVISIONAL_COMPUTER_PROFILE, type CharacterProfile } from './profile';
import type { RngState } from './rng';
import type {
  Controller,
  GameState,
  PlayerLocation,
  PlayerState,
  TileState,
  TurnState,
} from './state';

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
  /**
   * 'fixed' (default) puts every player on tile 0 facing away from behind(0), so on a loop board
   * they walk 0 -> 1 -> 2 -> ...; 'engine' keeps the engine's first-turn placement.
   */
  placement?: 'fixed' | 'engine';
  /** Seat by seat; missing seats are human. */
  controllers?: readonly Controller[];
  /** Computer seats' profiles, seat by seat; missing ones are PROVISIONAL_COMPUTER_PROFILE. */
  profiles?: readonly (CharacterProfile | undefined)[];
}

/** Seat `i` of a test game: p<i+1>, a computer with the given (or provisional) profile or human. */
export function testPlayerSetup(
  i: number,
  controller: Controller = 'human',
  profile: CharacterProfile = PROVISIONAL_COMPUTER_PROFILE,
): PlayerSetup {
  const base = { id: `p${i + 1}`, name: `玩家${i + 1}` };
  return controller === 'computer'
    ? { ...base, controller, profile }
    : { ...base, controller: 'human' };
}

/**
 * The neighbour helpers treat as "behind" a tile: the last link. loopBoard and TEST_LOOP_BOARD list
 * the forward neighbour first, so this is the previous tile of the loop.
 */
export function behind(board: Board, tile: TileIndex): TileIndex {
  const link = board.tiles[tile]?.links.at(-1);
  if (link === undefined) throw new Error(`tile ${tile} has no links`);
  return link.to;
}

/**
 * A started game on TEST_LOOP_BOARD (unless given); throws if the setup is invalid. See
 * TestGameOptions.placement for where the players stand.
 */
export function newTestGame(options: TestGameOptions = {}): GameState {
  const count = options.playerCount ?? 2;
  const board = options.board ?? TEST_LOOP_BOARD;
  const result = createGame({
    config: { ...DEFAULT_RULE_CONFIG, ...options.config },
    board,
    players: Array.from({ length: count }, (_, i) =>
      testPlayerSetup(i, options.controllers?.[i], options.profiles?.[i]),
    ),
    seed: options.seed ?? TEST_SEED,
  });
  if (!result.ok) {
    throw new Error(`invalid test game: ${JSON.stringify(result.errors)}`);
  }
  if (options.placement === 'engine') {
    return result.state;
  }
  const location: PlayerLocation = { kind: 'onBoard', tile: 0, prev: behind(board, 0) };
  return {
    ...result.state,
    players: result.state.players.map((p) => ({ ...p, location })),
  };
}

/** Puts a player on `tile`, having come from `prev` (default: behind(tile)). */
export function placePlayer(
  state: GameState,
  id: PlayerId,
  tile: TileIndex,
  prev: TileIndex = behind(state.board, tile),
): GameState {
  return patchPlayer(state, id, { location: { kind: 'onBoard', tile, prev } });
}

/** The tile a player stands on; throws if they are off the board. */
export function tileOf(state: GameState, id: PlayerId): TileIndex {
  const { location } = getPlayer(state, id);
  if (location.kind !== 'onBoard') throw new Error(`${id} is off the board`);
  return location.tile;
}

/** A property's own amounts, as loopBoard takes them; the name (street) defaults to T<index>. */
export type PropertySpec = Pick<PropertyTileDef, 'price' | 'upgradeCost' | 'rents'> & {
  name?: string;
};

/**
 * Made-up amounts for a property that only needs a price: upgrade cost floor(price / 2) and rents
 * floor(price * 10 / 30 / 60 / 100 / 150 / 200 %) at levels 0..5. Not from the original game.
 */
export function testProperty(price: number): PropertySpec {
  return {
    price,
    upgradeCost: Math.floor(price / 2),
    rents: [10, 30, 60, 100, 150, 200].map((percent) => Math.floor((price * percent) / 100)),
  };
}

/**
 * A loop 0 -> 1 -> ... -> 0. Each entry is a property (a price for testProperty's amounts, or the
 * amounts themselves), or null for a blank tile. Names are placeholders. Links list the forward
 * neighbour first (see behind).
 */
export function loopBoard(spec: readonly (number | PropertySpec | null)[]): Board {
  const n = spec.length;
  if (n < 3) throw new RangeError(`a loop needs at least 3 tiles, got ${n}`);
  const tiles = spec.map((entry, i): TileDef => {
    const links = [{ to: (i + 1) % n }, { to: (i + n - 1) % n }];
    const base = { name: `T${i}`, links, pos: { x: i, y: 0 } };
    if (entry === null) return { kind: 'blank', ...base };
    const amounts = typeof entry === 'number' ? testProperty(entry) : entry;
    return { kind: 'property', ...base, ...amounts };
  });
  return { id: 'test', name: 'test', tiles };
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

/** A well-formed action of the given type, with made-up parameters where it takes any. */
export function exampleAction(type: ActionType, playerId: PlayerId): Action {
  switch (type) {
    case 'bid':
      return { type, playerId, raise: 100 };
    case 'setDiceCount':
      return { type, playerId, count: 1 };
    default:
      return { type, playerId };
  }
}
