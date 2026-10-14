import { describe, expect, it } from 'vitest';
import { drawComputerLimits } from './computer';
import { actorOf, computerAction, legalActions } from './engine';
import { checkInvariants } from './invariants';
import type { AuctionPhase, Controller, GameState } from './state';
import {
  applyOk,
  getPlayer,
  loopBoard,
  newTestGame,
  patchPlayer,
  patchTile,
  patchTurn,
  scriptedRng,
  testProperty,
  type PropertySpec,
} from './testing';

const street = (name: string, price: number): PropertySpec => ({ name, ...testProperty(price) });

/** 7 properties: street A at 1, 2 and 6; street B at 3 and 4; street C at 5 and 7. */
const BOARD = loopBoard([
  null,
  street('A', 1000),
  street('A', 1000),
  street('B', 2000),
  street('B', 2000),
  street('C', 1000),
  street('A', 1000),
  street('C', 1000),
  null,
]);
const PROPERTIES = 7;
/** nextInt range of the random draws behind the computer factors (15 bits). */
const STEPS = 32768;
const MAX = STEPS - 1;
const RICH = 10_000_000;

/** p1 bankrupt; p2 human; p3 and p4 computers; everyone else rich. */
function game(controllers: Controller[] = ['human', 'human', 'computer', 'computer']): GameState {
  let state = newTestGame({ board: BOARD, playerCount: 4, controllers });
  state = patchPlayer(state, 'p1', { cash: 0, deposit: 0, bankrupt: true });
  for (const id of ['p2', 'p3', 'p4']) state = patchPlayer(state, id, { cash: RICH, deposit: 0 });
  return state;
}

/** p3's limit for tile 1 with start price `startPrice`, drawing r1 then r2. */
function limitOf(state: GameState, startPrice: number, r1: number, r2: number): number {
  const drawn = drawComputerLimits({ ...state, rngState: scriptedRng([r1, r2]) }, 1, startPrice, [
    'p3',
  ]);
  return drawn.limits.p3 ?? -1;
}

/** floor(f32(a) × f32(b) × c) as the original computes the first amount. */
const first = (product: number, ratioFactor: number, r1: number) =>
  Math.floor(product * Math.fround(ratioFactor) * Math.fround(0.5 + (0.3 * r1) / MAX));

describe('computer bid limits', () => {
  it('takes the first amount when it is the least', () => {
    // Level 0, no own properties on street A, 7 of 7 properties unowned: 1 × 1000 × 1 × (6 − 4).
    const state = game();
    expect(limitOf(state, 1000, 0, MAX)).toBe(first(1000, 6 - 4, 0));
    expect(limitOf(state, 1000, 0, MAX)).toBe(1000);
    expect(limitOf(state, 1000, MAX, MAX)).toBe(1600);
  });

  it('takes land price × price index × [3, 3.5) when that is the least', () => {
    let state = patchTile(game(), 1, { level: 4 });
    state = { ...state, priceIndex: 2 };
    // Start price 1000 × 3 × 2 = 6000; the first amount is far larger at level 4.
    expect(limitOf(state, 6000, MAX, 0)).toBe(1000 * 2 * 3);
    expect(limitOf(state, 6000, MAX, MAX)).toBe(Math.floor(2000 * (3 + MAX / 65536)));
    expect(limitOf(state, 6000, MAX, MAX)).toBeLessThan(2000 * 3.5);
  });

  it("takes the computer's cash when that is the least", () => {
    const state = patchPlayer(game(), 'p3', { cash: 999 });
    expect(limitOf(state, 1000, MAX, MAX)).toBe(999);
  });

  it('counts the level halved, own properties on the same street and the unowned share', () => {
    let state = patchTile(game(), 1, { level: 3 });
    // p3 owns tiles 2 and 6 on street A (not adjacent to each other) and 3 on street B; p4 owns
    // 7. Unowned: 1, 4, 5 of 7.
    for (const tile of [2, 6, 3]) state = patchTile(state, tile, { owner: 'p3' });
    state = patchTile(state, 7, { owner: 'p4' });
    const factor = 1 + 1 + 2; // floor(3 / 2) + 1 + 2 own on A
    // A low start price keeps the first amount below the second one.
    expect(limitOf(state, 100, 0, MAX)).toBe(first(factor * 100, 6 - (4 * 3) / PROPERTIES, 0));
  });

  it('does not count properties of other players or other streets', () => {
    let state = game();
    for (const tile of [2, 6]) state = patchTile(state, tile, { owner: 'p4' });
    state = patchTile(state, 3, { owner: 'p3' });
    expect(limitOf(state, 1000, 0, MAX)).toBe(first(1000, 6 - (4 * 4) / PROPERTIES, 0));
  });

  it('multiplies the start price by the price index once more in the first amount', () => {
    const state = { ...game(), priceIndex: 3 };
    // Start price 1000 × 3 already includes the price index once.
    expect(limitOf(state, 3000, 0, MAX)).toBe(first(3000 * 3, 2, 0));
  });

  it('draws for the computers among the bidders only, in seat order', () => {
    const state = { ...game(), rngState: scriptedRng([0, MAX, MAX, MAX]) };
    const drawn = drawComputerLimits(state, 1, 1000, ['p2', 'p3', 'p4']);
    expect(drawn.limits).toEqual({ p3: 1000, p4: 1600 });
    expect(drawn.rng).toEqual(scriptedRng([]));
  });

  it('keeps the limits hidden in the auction a bankruptcy opens', () => {
    let state = game(['human', 'human', 'computer', 'human']);
    state = patchPlayer(state, 'p1', { bankrupt: false, cash: 0, deposit: 0 });
    state = patchTile(state, 1, { owner: 'p2' });
    for (const tile of [3, 4, 5, 7]) state = patchTile(state, tile, { owner: 'p1' });
    // Die 1 onto p2's tile 1; draw tiles 3, 4, 5 of [3, 4, 5, 7]; then p3's two factors.
    state = { ...state, rngState: scriptedRng([0, 0, 0, 0, 0, MAX]) };
    const after = applyOk(state, { type: 'rollDice', playerId: 'p1' }).state;
    const { phase } = after.turn;
    expect(phase.kind).toBe('auction');
    if (phase.kind !== 'auction') return;
    expect(phase.tile).toBe(3);
    expect(Object.keys(phase.computerLimits)).toEqual(['p3']);
    expect(phase.computerLimits.p3).toBe(first(2000, 6 - (4 * 6) / PROPERTIES, 0));
    expect(checkInvariants(after)).toEqual([]);
  });
});

/** p3 (a computer) to bid on tile 1 at `price` with `limit`; p2 and p4 also bidding. */
function bidding(patch: Partial<AuctionPhase> & { limit: number }): GameState {
  const { limit, ...rest } = patch;
  const phase: AuctionPhase = {
    kind: 'auction',
    tile: 1,
    queue: [],
    startPrice: 1000,
    price: 1000,
    leader: null,
    bidder: 'p3',
    bidders: ['p2', 'p3', 'p4'].map((id) => ({ id, status: 'bidding' as const })),
    computerLimits: { p3: limit, p4: 0 },
    ...rest,
  };
  return patchTurn(game(), { current: 'p1', phase });
}

const choice = (state: GameState) => computerAction(state, 'p3');
const bid = (raise: number) => ({ type: 'bid', playerId: 'p3', raise });

describe('computer bidding', () => {
  it('raises by the largest step that keeps the price within its limit', () => {
    expect(choice(bidding({ limit: 6500 }))).toEqual(bid(5000));
    expect(choice(bidding({ limit: 11_000 }))).toEqual(bid(10_000));
    expect(choice(bidding({ limit: 1100 }))).toEqual(bid(100));
  });

  it('passes the round when even the smallest raise is over its limit', () => {
    expect(choice(bidding({ limit: 1099 }))).toEqual({ type: 'passRound', playerId: 'p3' });
  });

  it("lowers the raise when the leader's cash + 500 is short of the new price", () => {
    const led = (leaderCash: number) =>
      patchPlayer(bidding({ limit: 50_000, price: 1000, startPrice: 900, leader: 'p2' }), 'p2', {
        cash: leaderCash,
      });
    // d = leader's cash + 500 − price.
    expect(choice(led(1000))).toEqual(bid(500)); // d = 500
    expect(choice(led(1300))).toEqual(bid(1000)); // d = 800
    expect(choice(led(3000))).toEqual(bid(5000)); // d = 2500
    expect(choice(led(6000))).toEqual(bid(10_000)); // d = 5500: unchanged
    expect(choice(led(10_500))).toEqual(bid(10_000)); // 11000 is not short of 11000
  });

  it('raises by 100 only when it was the only bidder as the auction opened', () => {
    const lone = bidding({ limit: 50_000, bidders: [{ id: 'p3', status: 'bidding' }] });
    expect(choice(lone)).toEqual(bid(100));
    const poor = bidding({ limit: 1099, bidders: [{ id: 'p3', status: 'bidding' }] });
    expect(choice(poor)).toEqual({ type: 'passRound', playerId: 'p3' });
    // Alone only because the others withdrew: the usual choice.
    const left = bidding({
      limit: 50_000,
      bidders: [
        { id: 'p2', status: 'withdrawn' },
        { id: 'p3', status: 'bidding' },
        { id: 'p4', status: 'withdrawn' },
      ],
    });
    expect(choice(left)).toEqual(bid(10_000));
  });
});

describe('computerAction', () => {
  it('is null for a human, for someone the game is not waiting for, and after the game', () => {
    const state = game(['human', 'computer', 'computer', 'computer']);
    const p1Turn = patchPlayer(state, 'p1', { bankrupt: false });
    expect(computerAction(p1Turn, 'p1')).toBeNull();
    expect(computerAction(p1Turn, 'p2')).toBeNull();
    const over = patchTurn(p1Turn, { phase: { kind: 'gameOver', winners: ['p2'] } });
    expect(computerAction(over, 'p2')).toBeNull();
  });

  it('rolls, and buys or builds whenever offered (provisional, non-original)', () => {
    const state = patchTurn(game(['computer', 'human', 'human', 'human']), { current: 'p1' });
    const p1 = patchPlayer(state, 'p1', { bankrupt: false, cash: RICH });
    expect(computerAction(p1, 'p1')).toEqual({ type: 'rollDice', playerId: 'p1' });
    const buying = patchTurn(p1, { phase: { kind: 'awaitBuyDecision', tile: 1, price: 1000 } });
    expect(computerAction(buying, 'p1')).toEqual({ type: 'buyProperty', playerId: 'p1' });
    const building = patchTurn(patchTile(p1, 1, { owner: 'p1' }), {
      phase: { kind: 'awaitUpgradeDecision', tile: 1, cost: 500 },
    });
    expect(computerAction(building, 'p1')).toEqual({ type: 'upgradeProperty', playerId: 'p1' });
  });

  it('only ever picks a legal action in games with computers', () => {
    const board = loopBoard(Array.from({ length: 16 }, () => 2000));
    let moves = 0;
    let auctionMoves = 0;
    for (const seed of [1, 2, 3]) {
      let state = newTestGame({
        board,
        playerCount: 4,
        seed,
        // Two human seats (taking their last option) keep the game going past the first bankruptcy.
        controllers: ['human', 'computer', 'human', 'computer'],
      });
      state.players.forEach((p, seat) => {
        state = patchPlayer(state, p.id, { cash: seat === 0 ? 3000 : 40_000, deposit: 0 });
        for (let k = 0; k < 4; k++)
          state = patchTile(state, seat + 4 * k, { owner: p.id, level: 3 });
      });
      for (let step = 0; step < 1500 && state.turn.phase.kind !== 'gameOver'; step++) {
        const actor = actorOf(state) ?? '';
        const legal = legalActions(state, actor);
        const computer = getPlayer(state, actor).controller === 'computer';
        const picked = computerAction(state, actor);
        expect(picked === null).toBe(!computer);
        const action = picked ?? legal.at(-1);
        if (action === undefined) break;
        expect(legal).toContainEqual(action);
        if (state.turn.phase.kind === 'auction') auctionMoves++;
        state = applyOk(state, action).state;
        expect(checkInvariants(state)).toEqual([]);
        moves++;
      }
    }
    expect(moves).toBeGreaterThan(100);
    expect(auctionMoves).toBeGreaterThan(5);
  });
});
