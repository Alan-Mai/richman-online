// Bankruptcy auctions (docs/GAME_RULES.md §8): a few of the bankrupt player's properties, drawn at
// random, sold one by one to the other players with the system as the seller.
import type { Action } from './actions';
import type { RuleError } from './errors';
import type { GameEvent } from './events';
import type { PlayerId, TileIndex } from './ids';
import { auctionStartPrice, spend } from './money';
import { nextInt, type RngState } from './rng';
import type { AuctionBidder, AuctionBidderStatus, AuctionPhase, GameState } from './state';
import { playerOf, updateTile, type Step } from './update';

export type AuctionAction = Extract<Action, { type: 'bid' | 'passRound' | 'withdraw' }>;

/** A step of the auctions; done once the last drawn property has been sold or passed. */
export interface AuctionStep extends Step {
  done: boolean;
}

export type AuctionResult = { ok: true; step: AuctionStep } | { ok: false; error: RuleError };

function then(step: Step, next: (state: GameState) => AuctionStep): AuctionStep {
  const after = next(step.state);
  return { ...after, events: [...step.events, ...after.events] };
}

function withPhase(state: GameState, phase: AuctionPhase): GameState {
  return { ...state, turn: { ...state.turn, phase } };
}

/**
 * After a bankruptcy that leaves the game going: with more than auctionPlotCount released
 * properties, draws that many of them (no repeats) and opens the first auction. Done at once when
 * there is nothing to auction or nobody can bid on any of the drawn properties.
 */
export function startAuctions(state: GameState, released: readonly TileIndex[]): AuctionStep {
  const { auctionPlotCount } = state.config;
  if (released.length <= auctionPlotCount) {
    return { state, events: [], done: true };
  }
  // The original redraws a property already drawn; drawing from what is left gives the same
  // distribution with the engine's own RNG.
  const left = [...released];
  const drawn: TileIndex[] = [];
  let rng: RngState = state.rngState;
  for (let i = 0; i < auctionPlotCount; i++) {
    const [pick, next] = nextInt(rng, left.length);
    rng = next;
    drawn.push(...left.splice(pick, 1));
  }
  return openNext({ ...state, rngState: rng }, drawn);
}

/**
 * Opens the auction of the first of `tiles`. Everyone still in the game with more cash than the
 * start price may bid, in seat order; with nobody, the property is passed at once.
 */
function openNext(state: GameState, tiles: readonly TileIndex[]): AuctionStep {
  const [tile, ...queue] = tiles;
  if (tile === undefined) {
    return { state, events: [], done: true };
  }
  const startPrice = auctionStartPrice(state, tile);
  const bidders: AuctionBidder[] = state.players
    .filter((p) => !p.bankrupt && p.cash > startPrice)
    .map((p) => ({ id: p.id, status: 'bidding' }));
  const started: GameEvent = {
    type: 'AuctionStarted',
    tile,
    startPrice,
    bidders: bidders.map((b) => b.id),
    remaining: queue.length,
  };
  const first = bidders[0];
  if (first === undefined) {
    const unsold: Step = { state, events: [started, { type: 'AuctionUnsold', tile }] };
    return then(unsold, (s) => openNext(s, queue));
  }
  const phase: AuctionPhase = {
    kind: 'auction',
    tile,
    queue,
    startPrice,
    price: startPrice,
    leader: null,
    bidder: first.id,
    bidders,
  };
  return { state: withPhase(state, phase), events: [started], done: false };
}

/** The bidder's options: every raise their cash covers, passing the round and withdrawing. */
export function auctionActions(state: GameState, phase: AuctionPhase): Action[] {
  const playerId = phase.bidder;
  const { cash } = playerOf(state, playerId);
  return [
    ...state.config.auctionRaises
      .filter((raise) => cash >= phase.price + raise)
      .map((raise): Action => ({ type: 'bid', playerId, raise })),
    { type: 'passRound', playerId },
    { type: 'withdraw', playerId },
  ];
}

function setStatus(
  bidders: readonly AuctionBidder[],
  id: PlayerId,
  status: AuctionBidderStatus,
): AuctionBidder[] {
  return bidders.map((b) => (b.id === id ? { ...b, status } : b));
}

/** Applies the bidder's choice; the caller has checked the phase and that the sender is the bidder. */
export function applyAuctionAction(
  state: GameState,
  phase: AuctionPhase,
  action: AuctionAction,
): AuctionResult {
  const { playerId } = action;
  switch (action.type) {
    case 'bid': {
      if (!state.config.auctionRaises.includes(action.raise)) {
        return { ok: false, error: { code: 'invalidAction' } };
      }
      const price = phase.price + action.raise;
      if (playerOf(state, playerId).cash < price) {
        return { ok: false, error: { code: 'insufficientFunds' } };
      }
      // A raise asks everyone who passed again.
      const bidders = phase.bidders.map((b): AuctionBidder =>
        b.status === 'passed' ? { ...b, status: 'bidding' } : b,
      );
      const raised: GameEvent = { type: 'AuctionRaised', playerId, raise: action.raise, price };
      return {
        ok: true,
        step: proceed(state, { ...phase, price, leader: playerId, bidders }, [raised]),
      };
    }
    case 'passRound': {
      const bidders = setStatus(phase.bidders, playerId, 'passed');
      const passed: GameEvent = { type: 'AuctionPassed', playerId };
      return { ok: true, step: proceed(state, { ...phase, bidders }, [passed]) };
    }
    case 'withdraw': {
      const bidders = setStatus(phase.bidders, playerId, 'withdrawn');
      const left: GameEvent = { type: 'AuctionWithdrawn', playerId, reason: 'chose' };
      return { ok: true, step: proceed(state, { ...phase, bidders }, [left]) };
    }
  }
}

/**
 * After every move: with nobody left, or everyone left having passed, the property goes unsold;
 * with one bidder left, or one who has not passed, and a highest bid, it is sold to the leader.
 * Otherwise the next bidder in seat order who has not withdrawn is asked (those who passed are
 * asked again); one whose cash is below the price withdraws on the spot.
 */
function proceed(state: GameState, phase: AuctionPhase, events: GameEvent[]): AuctionStep {
  let current = phase;
  const out: GameEvent[] = [...events];
  for (;;) {
    const active = current.bidders.filter((b) => b.status !== 'withdrawn');
    const passed = active.filter((b) => b.status === 'passed').length;
    const { tile, queue, leader } = current;
    if (active.length === 0 || active.length === passed) {
      out.push({ type: 'AuctionUnsold', tile });
      return then({ state, events: out }, (s) => openNext(s, queue));
    }
    if (leader !== null && (active.length === 1 || active.length - passed === 1)) {
      const sold = sell(state, leader, tile, current.price);
      return then({ state: sold.state, events: [...out, ...sold.events] }, (s) =>
        openNext(s, queue),
      );
    }
    const bidder = nextBidder(current);
    if (playerOf(state, bidder).cash < current.price) {
      out.push({ type: 'AuctionWithdrawn', playerId: bidder, reason: 'shortOfCash' });
      current = { ...current, bidders: setStatus(current.bidders, bidder, 'withdrawn') };
      continue;
    }
    return { state: withPhase(state, { ...current, bidder }), events: out, done: false };
  }
}

/** The next bidder after the current one in seat order who has not withdrawn. */
function nextBidder(phase: AuctionPhase): PlayerId {
  const { bidders } = phase;
  const from = bidders.findIndex((b) => b.id === phase.bidder);
  for (let offset = 1; offset <= bidders.length; offset++) {
    const candidate = bidders[(from + offset) % bidders.length];
    if (candidate !== undefined && candidate.status !== 'withdrawn') {
      return candidate.id;
    }
  }
  throw new Error('no bidder left to ask');
}

/** The leader pays the system (into the lottery pool) and takes the property, buildings and all. */
function sell(state: GameState, winner: PlayerId, tile: TileIndex, price: number): Step {
  const paid = spend(state, winner, price);
  return {
    state: {
      ...updateTile(paid.state, tile, { owner: winner }),
      lotteryPool: paid.state.lotteryPool + price,
    },
    events: [...paid.events, { type: 'AuctionWon', playerId: winner, tile, price }],
  };
}
