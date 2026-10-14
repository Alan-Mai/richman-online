import type { Board } from './board';
import type { RuleConfig } from './config';
import type { PlayerId, TileIndex } from './ids';
import type { RngState } from './rng';

/**
 * Where a player is. Everyone starts off the board and is placed on a random tile when their first
 * turn starts (docs/GAME_RULES.md §1).
 */
export type PlayerLocation =
  | { kind: 'offBoard' }
  | {
      kind: 'onBoard';
      tile: TileIndex;
      /**
       * The tile the player came from, always a neighbour of tile. It is the only notion of
       * direction: the next step never goes back here unless the player is at a dead end.
       */
      prev: TileIndex;
    };

export interface PlayerState {
  id: PlayerId;
  name: string;
  cash: number;
  deposit: number;
  points: number;
  location: PlayerLocation;
  diceCount: number;
  bankrupt: boolean;
}

/** Parallel to Board.tiles. Non-property tiles always have owner null and level 0. */
export interface TileState {
  owner: PlayerId | null;
  level: number;
}

/** What the game is waiting for. */
export type Phase =
  | { kind: 'awaitRoll' }
  | { kind: 'awaitBuyDecision'; tile: TileIndex; price: number }
  | { kind: 'awaitUpgradeDecision'; tile: TileIndex; cost: number }
  | { kind: 'gameOver'; winners: readonly PlayerId[] };

export type PhaseKind = Phase['kind'];

export interface TurnState {
  current: PlayerId;
  /** Starts at 1; increments when play wraps back to seat 0. */
  round: number;
  phase: Phase;
}

export interface GameState {
  config: RuleConfig;
  board: Board;
  /** Seat order. */
  players: readonly PlayerState[];
  tiles: readonly TileState[];
  turn: TurnState;
  /** Server-only; viewFor strips it. */
  rngState: RngState;
}
