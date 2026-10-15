// What one client may see. Fields are copied by name so new GameState fields stay hidden until
// they are deliberately added here.
import type { Board } from './board';
import type { CalendarDate } from './calendar';
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

/** A player as clients see them: everything but the computer's character profile. */
export type PlayerStateView = Omit<PlayerState, 'profile'>;

export interface PlayerView {
  viewer: Viewer;
  config: RuleConfig;
  board: Board;
  players: readonly PlayerStateView[];
  tiles: readonly TileState[];
  turn: TurnView;
  day: number;
  date: CalendarDate;
  priceIndex: number;
}

/**
 * Filters the state for one viewer. Hidden from everyone: rngState, the lottery pool, the drawn
 * properties still to be auctioned (sent only as a count), the computers' pre-drawn choices and
 * their character profiles.
 * Per-player secrets (hands of cards) will be filtered here per viewer.
 */
export function viewFor(state: GameState, viewer: Viewer): PlayerView {
  return {
    viewer: { ...viewer },
    config: state.config,
    board: state.board,
    players: state.players.map(viewPlayer),
    tiles: state.tiles.map((t) => ({ ...t })),
    turn: { ...state.turn, phase: viewPhase(state.turn.phase) },
    day: state.day,
    date: { ...state.date },
    priceIndex: state.priceIndex,
  };
}

/** Copied field by field: the profile stays hidden. */
function viewPlayer(p: PlayerState): PlayerStateView {
  return {
    id: p.id,
    name: p.name,
    controller: p.controller,
    cash: p.cash,
    deposit: p.deposit,
    points: p.points,
    location: { ...p.location },
    vehicle: p.vehicle,
    diceCount: p.diceCount,
    bankrupt: p.bankrupt,
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
