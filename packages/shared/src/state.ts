import type { Board } from './board';
import type { RuleConfig, Vehicle } from './config';
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

/**
 * Who makes a player's decisions. Computer players' moves come from computerAction, run by the
 * server or simulator, and still go through applyAction.
 */
export type Controller = 'human' | 'computer';

export interface PlayerState {
  id: PlayerId;
  name: string;
  controller: Controller;
  cash: number;
  deposit: number;
  points: number;
  location: PlayerLocation;
  vehicle: Vehicle;
  /** How many dice the next roll uses: 1..RuleConfig.vehicleMaxDice of the vehicle. */
  diceCount: number;
  bankrupt: boolean;
}

/**
 * Parallel to Board.tiles. Non-property tiles always have owner null and level 0; an unowned
 * property may keep the buildings of a bankrupt owner (docs/GAME_RULES.md §8).
 */
export interface TileState {
  owner: PlayerId | null;
  level: number;
}

/**
 * A bidder's standing in the current auction: still bidding, passed this round (asked again after
 * the next raise or once the others have had their turn), or out for good.
 */
export type AuctionBidderStatus = 'bidding' | 'passed' | 'withdrawn';

export interface AuctionBidder {
  id: PlayerId;
  status: AuctionBidderStatus;
}

/**
 * One property being auctioned off after a bankruptcy (docs/GAME_RULES.md §8). The seller is the
 * system; turn.current stays the bankrupt player until the last drawn property is done.
 */
export interface AuctionPhase {
  kind: 'auction';
  tile: TileIndex;
  /** The properties drawn to be auctioned after this one, in order. Hidden from clients. */
  queue: readonly TileIndex[];
  startPrice: number;
  /** startPrice until someone raises. */
  price: number;
  /** The highest bidder; null until someone raises. */
  leader: PlayerId | null;
  /** Whose turn it is to bid; never the leader. */
  bidder: PlayerId;
  /** The players who could bid when the auction opened, in seat order. */
  bidders: readonly AuctionBidder[];
  /**
   * Each computer bidder's limit, drawn when the auction opened (RuleConfig.computerBid). Hidden
   * from clients.
   */
  computerLimits: Readonly<Record<PlayerId, number>>;
}

/** What the game is waiting for. */
export type Phase =
  | {
      kind: 'awaitRoll';
      /**
       * On a computer's turn on a motorbike or car: the dice count it chose as the turn started
       * (docs/GAME_RULES.md §9), drawn ahead so computerAction stays a pure choice. Hidden from
       * clients.
       */
      computerDiceCount?: number;
    }
  | { kind: 'awaitBuyDecision'; tile: TileIndex; price: number }
  | { kind: 'awaitUpgradeDecision'; tile: TileIndex; cost: number }
  | AuctionPhase
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
  /**
   * Days gone by: 0 in a new game, +1 each time play wraps back to seat 0 (docs/GAME_RULES.md §2).
   */
  day: number;
  /** The price index (coef, docs/GAME_RULES.md §3): starts at 1 and never falls. */
  priceIndex: number;
  /**
   * The lottery prize pool (docs/GAME_RULES.md §4): auction proceeds and what is left of a debt to
   * the system go here. Drawing it is Phase 5; viewFor does not send it for now.
   */
  lotteryPool: number;
  /** Server-only; viewFor strips it. */
  rngState: RngState;
}
