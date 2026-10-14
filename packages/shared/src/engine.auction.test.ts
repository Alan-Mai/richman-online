import { describe, expect, it } from 'vitest';
import { actorOf, applyAction, legalActions } from './engine';
import type { GameEvent } from './events';
import { auctionStartPrice } from './money';
import type { AuctionBidder, AuctionPhase, GameState } from './state';
import {
  applyOk,
  getPlayer,
  loopBoard,
  newTestGame,
  patchPlayer,
  patchTile,
  patchTurn,
  scriptedRng,
} from './testing';

/** Tile 1 belongs to p2 (rent 100 at level 0); tiles 2..8 cost 1000, upgrade 500. */
const BOARD = loopBoard([null, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, null]);
const RAISES = [100, 500, 1000, 5000, 10000];

interface Bankruptcy {
  /** Tiles p1 owns, with their levels. */
  owned: Record<number, number>;
  /** nextInt results after the die: the draws of the properties to auction. */
  draws?: number[];
  playerCount?: number;
  cash?: Partial<Record<string, number>>;
  priceIndex?: number;
  /** Defaults to p1. */
  debtor?: string;
}

/**
 * The debtor (current player) rolls a 1 onto p2's tile 1 with only 50 to their name and goes
 * bankrupt. Everyone else has 20000 cash unless `cash` says otherwise.
 */
function bankrupt({
  owned,
  draws = [],
  playerCount = 4,
  cash = {},
  priceIndex = 1,
  debtor = 'p1',
}: Bankruptcy) {
  let state: GameState = { ...newTestGame({ board: BOARD, playerCount }), priceIndex };
  state = patchTurn(patchTile(state, 1, { owner: 'p2' }), { current: debtor });
  for (const [tile, level] of Object.entries(owned)) {
    state = patchTile(state, Number(tile), { owner: debtor, level });
  }
  for (const p of state.players) {
    const money =
      p.id === debtor ? { cash: 0, deposit: 50 } : { cash: cash[p.id] ?? 20_000, deposit: 0 };
    state = patchPlayer(state, p.id, money);
  }
  const rolling = { ...state, rngState: scriptedRng([0, ...draws]) };
  return applyOk(rolling, { type: 'rollDice', playerId: debtor });
}

function auctionOf(state: GameState): AuctionPhase {
  const { phase } = state.turn;
  expect(phase.kind).toBe('auction');
  if (phase.kind !== 'auction') throw new Error('not in an auction');
  return phase;
}

const types = (events: readonly GameEvent[]) => events.map((e) => e.type);

const bidding = (...ids: string[]): AuctionBidder[] => ids.map((id) => ({ id, status: 'bidding' }));

/**
 * p1 went bankrupt; tile 2 (level 0, start price 1000) is up with `patch` applied and nothing left
 * to auction after it. p2..p4 have 20000 cash unless `cash` says otherwise.
 */
function auction(
  patch: Partial<AuctionPhase> = {},
  cash: Partial<Record<string, number>> = {},
): GameState {
  let state = newTestGame({ board: BOARD, playerCount: 4 });
  state = patchPlayer(state, 'p1', { cash: 0, deposit: 0, bankrupt: true });
  for (const p of state.players.slice(1)) {
    state = patchPlayer(state, p.id, { cash: cash[p.id] ?? 20_000, deposit: 0 });
  }
  const phase: AuctionPhase = {
    kind: 'auction',
    tile: 2,
    queue: [],
    startPrice: 1000,
    price: 1000,
    leader: null,
    bidder: 'p2',
    bidders: bidding('p2', 'p3', 'p4'),
    ...patch,
  };
  const started = patchTurn(state, { current: 'p1', phase });
  // Precondition: the auction waits for its bidder, not the bankrupt current player.
  expect(actorOf(started)).toBe(phase.bidder);
  return started;
}

const bid = (playerId: string, raise: number) => ({ type: 'bid' as const, playerId, raise });
const pass = (playerId: string) => ({ type: 'passRound' as const, playerId });
const withdraw = (playerId: string) => ({ type: 'withdraw' as const, playerId });

describe('bankruptcy auctions: which properties', () => {
  it('auctions nothing when the bankrupt player owned 3 properties or fewer', () => {
    const { state, events } = bankrupt({ owned: { 2: 1, 3: 0, 4: 2 } });
    expect(types(events)).not.toContain('AuctionStarted');
    expect(state.turn).toMatchObject({ current: 'p2', phase: { kind: 'awaitRoll' } });
    expect(state.tiles.slice(2, 5)).toEqual([
      { owner: null, level: 1 },
      { owner: null, level: 0 },
      { owner: null, level: 2 },
    ]);
  });

  it('draws 3 distinct properties with the RNG and auctions them in the order drawn', () => {
    // From [2, 3, 4, 5]: index 2 -> 4; from [2, 3, 5]: index 0 -> 2; from [3, 5]: index 1 -> 5.
    const { state, events } = bankrupt({ owned: { 2: 0, 3: 0, 4: 1, 5: 0 }, draws: [2, 0, 1] });
    expect(events.at(-1)).toEqual({
      type: 'AuctionStarted',
      tile: 4,
      startPrice: 1500,
      bidders: ['p2', 'p3', 'p4'],
      remaining: 2,
    });
    expect(types(events)).not.toContain('TurnStarted');
    const phase = auctionOf(state);
    expect(phase.queue).toEqual([2, 5]);
    expect(state.turn.current).toBe('p1');
    expect(actorOf(state)).toBe('p2');
    // Every released property is unowned, auctioned or not.
    expect(state.tiles.slice(2, 6).map((t) => t.owner)).toEqual([null, null, null, null]);
  });

  it('skips the auctions when the bankruptcy leaves one player standing', () => {
    const { state, events } = bankrupt({
      owned: { 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 },
      playerCount: 2,
      draws: [0, 0, 0],
    });
    expect(types(events)).not.toContain('AuctionStarted');
    expect(state.turn.phase).toEqual({ kind: 'gameOver', winners: ['p2'] });
  });
});

describe('bankruptcy auctions: opening', () => {
  it('starts at floor(land price × (1 + 0.5 × level)) × price index', () => {
    const board = loopBoard([null, 1001, null]);
    const at = (level: number) => ({
      board,
      priceIndex: 3,
      tiles: [null, null, null].map((_, i) => ({ owner: null, level: i === 1 ? level : 0 })),
    });
    // 1001 × 1.5 = 1501.5 and 1001 × 3.5 = 3503.5 are rounded down before the price index.
    expect(auctionStartPrice(at(0), 1)).toBe(1001 * 3);
    expect(auctionStartPrice(at(1), 1)).toBe(1501 * 3);
    expect(auctionStartPrice(at(5), 1)).toBe(3503 * 3);
  });

  it('lets in only players still in the game with more cash than the start price', () => {
    // Tile 4 at level 1 and price index 2 starts at 3000.
    const { state, events } = bankrupt({
      owned: { 2: 0, 3: 0, 4: 1, 5: 0 },
      draws: [2, 0, 0],
      priceIndex: 2,
      cash: { p2: 3000, p3: 3001, p4: 99_999 },
    });
    expect(events.at(-1)).toMatchObject({ type: 'AuctionStarted', tile: 4, startPrice: 3000 });
    expect(auctionOf(state).bidders).toEqual(bidding('p3', 'p4'));
    expect(actorOf(state)).toBe('p3');
  });

  it('passes a property nobody can bid on and goes on to the next one', () => {
    // Levels 5, 0, 0, 0: tile 2 starts at 3500, the others at 1000.
    const { state, events } = bankrupt({
      owned: { 2: 5, 3: 0, 4: 0, 5: 0 },
      draws: [0, 0, 0],
      cash: { p2: 2000, p3: 1000, p4: 3500 },
    });
    expect(events.slice(-3)).toEqual([
      { type: 'AuctionStarted', tile: 2, startPrice: 3500, bidders: [], remaining: 2 },
      { type: 'AuctionUnsold', tile: 2 },
      { type: 'AuctionStarted', tile: 3, startPrice: 1000, bidders: ['p2', 'p4'], remaining: 1 },
    ]);
    expect(state.tiles[2]).toEqual({ owner: null, level: 5 });
  });

  it('starts with the lowest seat among the bidders, not the player after the bankrupt one', () => {
    const { state } = bankrupt({
      owned: { 2: 0, 3: 0, 4: 0, 5: 0 },
      draws: [0, 0, 0],
      debtor: 'p3',
    });
    expect(auctionOf(state).bidders).toEqual(bidding('p1', 'p2', 'p4'));
    expect(state.turn.current).toBe('p3');
    expect(actorOf(state)).toBe('p1');
  });

  it('ends the turn once nothing is left to auction', () => {
    const { state, events } = bankrupt({
      owned: { 2: 0, 3: 0, 4: 0, 5: 0 },
      draws: [0, 0, 0],
      cash: { p2: 0, p3: 0, p4: 0 },
    });
    expect(types(events).slice(-7)).toEqual([
      'AuctionStarted',
      'AuctionUnsold',
      'AuctionStarted',
      'AuctionUnsold',
      'AuctionStarted',
      'AuctionUnsold',
      'TurnStarted',
    ]);
    expect(state.turn).toMatchObject({ current: 'p2', phase: { kind: 'awaitRoll' } });
  });
});

describe('bankruptcy auctions: bidding', () => {
  it('offers every raise the bidder can cover, passing and withdrawing', () => {
    const rich = auction();
    expect(legalActions(rich, 'p2')).toEqual([
      ...RAISES.map((raise) => bid('p2', raise)),
      pass('p2'),
      withdraw('p2'),
    ]);
    // 1000 + 500 is covered, 1000 + 1000 is not.
    const poor = auction({}, { p2: 1999 });
    expect(legalActions(poor, 'p2')).toEqual([
      bid('p2', 100),
      bid('p2', 500),
      pass('p2'),
      withdraw('p2'),
    ]);
    for (const other of ['p1', 'p3', 'p4']) expect(legalActions(rich, other)).toEqual([]);
  });

  it('raises the price, makes the bidder the leader and clears every pass', () => {
    const start = auction({
      bidder: 'p3',
      bidders: [
        { id: 'p2', status: 'passed' },
        { id: 'p3', status: 'bidding' },
        { id: 'p4', status: 'withdrawn' },
      ],
    });
    const { state, events } = applyOk(start, bid('p3', 500));
    expect(events).toEqual([{ type: 'AuctionRaised', playerId: 'p3', raise: 500, price: 1500 }]);
    expect(auctionOf(state)).toMatchObject({
      price: 1500,
      leader: 'p3',
      bidder: 'p2',
      bidders: [
        { id: 'p2', status: 'bidding' },
        { id: 'p3', status: 'bidding' },
        { id: 'p4', status: 'withdrawn' },
      ],
    });
  });

  it('asks the next bidder in seat order, skipping those who withdrew but not those who passed', () => {
    const start = auction({
      bidder: 'p4',
      bidders: [
        { id: 'p2', status: 'withdrawn' },
        { id: 'p3', status: 'passed' },
        { id: 'p4', status: 'bidding' },
      ],
      leader: null,
    });
    const { state } = applyOk(start, bid('p4', 100));
    expect(auctionOf(state).bidder).toBe('p3');

    const passing = auction({ bidders: bidding('p2', 'p3', 'p4') });
    const after = applyOk(passing, pass('p2'));
    expect(after.events).toEqual([{ type: 'AuctionPassed', playerId: 'p2' }]);
    expect(auctionOf(after.state)).toMatchObject({
      bidder: 'p3',
      bidders: [
        { id: 'p2', status: 'passed' },
        { id: 'p3', status: 'bidding' },
        { id: 'p4', status: 'bidding' },
      ],
    });
    const out = applyOk(after.state, withdraw('p3'));
    expect(out.events).toEqual([{ type: 'AuctionWithdrawn', playerId: 'p3', reason: 'chose' }]);
    expect(auctionOf(out.state).bidder).toBe('p4');
  });

  it('withdraws a bidder whose cash is below the current price when their turn comes', () => {
    const start = auction({ price: 1000 }, { p2: 20_000, p3: 1400, p4: 20_000 });
    const { state, events } = applyOk(start, bid('p2', 500));
    expect(events).toEqual([
      { type: 'AuctionRaised', playerId: 'p2', raise: 500, price: 1500 },
      { type: 'AuctionWithdrawn', playerId: 'p3', reason: 'shortOfCash' },
    ]);
    expect(auctionOf(state)).toMatchObject({
      bidder: 'p4',
      bidders: [
        { id: 'p2', status: 'bidding' },
        { id: 'p3', status: 'withdrawn' },
        { id: 'p4', status: 'bidding' },
      ],
    });
  });

  it('lets a bidder with exactly the current price pass or withdraw', () => {
    const state = auction({ price: 1500, leader: 'p3', bidder: 'p4' }, { p4: 1500 });
    expect(legalActions(state, 'p4')).toEqual([pass('p4'), withdraw('p4')]);
  });
});

describe('bankruptcy auctions: closing', () => {
  it('sells to the leader once everyone else has passed', () => {
    let state = auction({ queue: [] });
    state = applyOk(state, bid('p2', 1000)).state;
    state = applyOk(state, pass('p3')).state;
    const { state: sold, events } = applyOk(state, pass('p4'));
    expect(events.slice(0, 2)).toEqual([
      { type: 'AuctionPassed', playerId: 'p4' },
      { type: 'AuctionWon', playerId: 'p2', tile: 2, price: 2000 },
    ]);
    expect(getPlayer(sold, 'p2')).toMatchObject({ cash: 18_000, deposit: 0 });
    expect(sold.tiles[2]).toEqual({ owner: 'p2', level: 0 });
    expect(sold.lotteryPool).toBe(2000);
  });

  it('sells to the leader once everyone else has withdrawn', () => {
    let state = auction();
    state = applyOk(state, withdraw('p2')).state;
    state = applyOk(state, bid('p3', 100)).state;
    const { events } = applyOk(state, withdraw('p4'));
    expect(events[1]).toEqual({ type: 'AuctionWon', playerId: 'p3', tile: 2, price: 1100 });
  });

  it('passes the property when everyone passes without a raise', () => {
    let state = auction();
    state = applyOk(state, pass('p2')).state;
    state = applyOk(state, pass('p3')).state;
    expect(actorOf(state)).toBe('p4');
    const { state: after, events } = applyOk(state, pass('p4'));
    expect(events[1]).toEqual({ type: 'AuctionUnsold', tile: 2 });
    expect(after.tiles[2]).toEqual({ owner: null, level: 0 });
    expect(after.lotteryPool).toBe(0);
  });

  it('passes the property when everyone withdraws', () => {
    let state = auction({ bidders: bidding('p2', 'p3') });
    state = applyOk(state, withdraw('p2')).state;
    const { events } = applyOk(state, withdraw('p3'));
    expect(events[1]).toEqual({ type: 'AuctionUnsold', tile: 2 });
  });

  it('keeps asking a lone bidder until they raise or pass', () => {
    const lone = auction({ bidders: bidding('p3'), bidder: 'p3' });
    const won = applyOk(lone, bid('p3', 100));
    expect(won.events[1]).toEqual({ type: 'AuctionWon', playerId: 'p3', tile: 2, price: 1100 });
    const unsold = applyOk(lone, pass('p3'));
    expect(unsold.events[1]).toEqual({ type: 'AuctionUnsold', tile: 2 });
  });

  it('keeps the buildings and moves on to the next drawn property', () => {
    let state = auction({ queue: [5, 3], bidders: bidding('p2') });
    state = patchTile(patchTile(state, 2, { level: 3 }), 5, { level: 2 });
    const { state: next, events } = applyOk(state, bid('p2', 100));
    expect(events.slice(1)).toEqual([
      { type: 'AuctionWon', playerId: 'p2', tile: 2, price: 1100 },
      {
        type: 'AuctionStarted',
        tile: 5,
        startPrice: 2000,
        bidders: ['p2', 'p3', 'p4'],
        remaining: 1,
      },
    ]);
    expect(next.tiles[2]).toEqual({ owner: 'p2', level: 3 });
    expect(auctionOf(next)).toMatchObject({ tile: 5, queue: [3], price: 2000, leader: null });
  });

  it("ends the bankrupt player's turn after the last property", () => {
    const state = auction({ bidders: bidding('p2') });
    const { state: after, events } = applyOk(state, pass('p2'));
    expect(events.slice(1)).toEqual([
      { type: 'AuctionUnsold', tile: 2 },
      { type: 'TurnStarted', playerId: 'p2', round: 1 },
    ]);
    expect(after.turn).toMatchObject({ current: 'p2', phase: { kind: 'awaitRoll' } });
  });
});

describe('bankruptcy auctions: rejected actions', () => {
  it('refuses actions from anyone but the bidder', () => {
    const state = auction();
    for (const playerId of ['p1', 'p3']) {
      expect(applyAction(state, pass(playerId))).toEqual({
        ok: false,
        error: { code: 'notYourTurn' },
      });
    }
  });

  it('refuses other actions during an auction and auction actions outside one', () => {
    const state = auction();
    expect(applyAction(state, { type: 'rollDice', playerId: 'p2' })).toEqual({
      ok: false,
      error: { code: 'wrongPhase', phase: 'auction' },
    });
    const rolling = newTestGame();
    for (const action of [bid('p1', 100), pass('p1'), withdraw('p1')]) {
      expect(applyAction(rolling, action)).toEqual({
        ok: false,
        error: { code: 'wrongPhase', phase: 'awaitRoll' },
      });
    }
  });

  it('refuses raises that are not in the table, malformed or not covered by cash', () => {
    const state = auction({}, { p2: 1999 });
    for (const raise of [200, 0, -100, 1.5]) {
      expect(applyAction(state, bid('p2', raise))).toEqual({
        ok: false,
        error: { code: 'invalidAction' },
      });
    }
    const missing = { type: 'bid', playerId: 'p2' } as unknown as Parameters<typeof applyAction>[1];
    expect(applyAction(state, missing)).toEqual({ ok: false, error: { code: 'invalidAction' } });
    expect(applyAction(state, bid('p2', 1000))).toEqual({
      ok: false,
      error: { code: 'insufficientFunds' },
    });
  });
});
