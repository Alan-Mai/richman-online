// What one client may see. Fields are copied by name so new GameState fields stay hidden until
// they are deliberately added here.
import type { Board } from './board';
import type { RuleConfig } from './config';
import type { PlayerId } from './ids';
import type { AuctionPhase, GameState, Phase, PlayerState, TileState, TurnState } from './state';

/** Who the view is for. A tagged union so no player id can be mistaken for a spectator. */
export type Viewer = { kind: 'player'; id: PlayerId } | { kind: 'spectator' };

/** An auction as clients see it: the drawn properties still to come only as a count. */
export type AuctionPhaseView = Omit<AuctionPhase, 'queue' | 'computerLimits'> & {
  remaining: number;
};

export type PhaseView = Exclude<Phase, AuctionPhase> | AuctionPhaseView;

export type TurnView = Omit<TurnState, 'phase'> & { phase: PhaseView };

export interface PlayerView {
  viewer: Viewer;
  config: RuleConfig;
  board: Board;
  players: readonly PlayerState[];
  tiles: readonly TileState[];
  turn: TurnView;
  day: number;
  priceIndex: number;
}

/**
 * Filters the state for one viewer. Phase 2 has no per-player secrets, so only rngState is
 * dropped; later hidden fields (hands of cards) are filtered here per viewer.
 */
export function viewFor(state: GameState, viewer: Viewer): PlayerView {
  return {
    viewer: { ...viewer },
    config: state.config,
    board: state.board,
    players: state.players.map((p) => ({ ...p, location: { ...p.location } })),
    tiles: state.tiles.map((t) => ({ ...t })),
    turn: { ...state.turn, phase: viewPhase(state.turn.phase) },
    day: state.day,
    priceIndex: state.priceIndex,
  };
}

function viewPhase(phase: Phase): PhaseView {
  if (phase.kind === 'awaitRoll') {
    // The computer's chosen dice count stays hidden until it sets it.
    return { kind: phase.kind };
  }
  if (phase.kind !== 'auction') {
    return phase;
  }
  // Copied field by field: the queue and the computer limits stay hidden.
  return {
    kind: phase.kind,
    tile: phase.tile,
    startPrice: phase.startPrice,
    price: phase.price,
    leader: phase.leader,
    bidder: phase.bidder,
    bidders: phase.bidders.map((b) => ({ ...b })),
    remaining: phase.queue.length,
  };
}
