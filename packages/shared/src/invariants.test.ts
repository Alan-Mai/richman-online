import { describe, expect, it } from 'vitest';
import type { Vehicle } from './config';
import { checkInvariants } from './invariants';
import { PROVISIONAL_COMPUTER_PROFILE } from './profile';
import type { AuctionPhase, GameState, Phase } from './state';
import { loopBoard, newTestGame, patchPlayer, patchTile, patchTurn, placePlayer } from './testing';

/** Tiles 0 and 3 are blank; tile 1 costs 1000 (upgrade 500 at the default 50%), tile 2 costs 2000. */
const BOARD = loopBoard([null, 1000, 2000, null]);

/** Turns a player into a computer with the provisional profile. */
const COMPUTER = { controller: 'computer', profile: PROVISIONAL_COMPUTER_PROFILE } as const;

/** Two players on BOARD; p1 is current and waiting to roll. */
const base = (): GameState => newTestGame({ board: BOARD });

/** p1 standing on tile 1 while the game waits for `phase`. */
const deciding = (phase: Phase): GameState => patchTurn(placePlayer(base(), 'p1', 1), { phase });

const buy = (patch: Partial<{ tile: number; price: number }> = {}): Phase => ({
  kind: 'awaitBuyDecision',
  tile: 1,
  price: 1000,
  ...patch,
});

const upgrade = (patch: Partial<{ tile: number; cost: number }> = {}): Phase => ({
  kind: 'awaitUpgradeDecision',
  tile: 1,
  cost: 500,
  ...patch,
});

describe('checkInvariants', () => {
  it('accepts freshly created games', () => {
    expect(checkInvariants(base())).toEqual([]);
    expect(checkInvariants(newTestGame({ playerCount: 4 }))).toEqual([]);
    // Seats after the current player wait off the board during round 1.
    const placing = newTestGame({ playerCount: 4, placement: 'engine' });
    expect(checkInvariants(placing)).toEqual([]);
    expect(checkInvariants(patchTurn(placing, { current: 'p2' }))).toContain(
      'player p2: off the board after their first turn started',
    );
  });

  it('accepts consistent decision and game-over phases', () => {
    expect(checkInvariants(deciding(buy()))).toEqual([]);
    expect(checkInvariants(patchTile(deciding(upgrade()), 1, { owner: 'p1', level: 4 }))).toEqual(
      [],
    );
    const over = patchTurn(patchPlayer(base(), 'p1', { bankrupt: true, cash: 0, deposit: 0 }), {
      phase: { kind: 'gameOver', winners: ['p2'] },
    });
    expect(checkInvariants(over)).toEqual([]);
  });

  it('accepts unowned properties with buildings left by a bankruptcy', () => {
    const state = patchTile(base(), 1, { level: 2 });
    expect(checkInvariants(state)).toEqual([]);
    const buying = patchTile(deciding(buy({ price: 1000 + 2 * 500 })), 1, { level: 2 });
    expect(checkInvariants(buying)).toEqual([]);
  });

  const cases: [string, () => GameState, string][] = [
    ['negative day', () => ({ ...base(), day: -1 }), 'day -1 is not a non-negative integer'],
    ['fractional day', () => ({ ...base(), day: 0.5 }), 'day 0.5 is not a non-negative integer'],
    [
      'date behind the day count',
      () => ({ ...base(), day: 2 }),
      'date 2010-01-01 is not 2 days after the start date 2010-01-01',
    ],
    [
      'date that does not exist',
      () => ({ ...base(), date: { year: 2010, month: 2, day: 30 } }),
      'date 2010-02-30 is not a valid date',
    ],
    ['price index 0', () => ({ ...base(), priceIndex: 0 }), 'priceIndex 0 is not an integer >= 1'],
    [
      'fractional price index',
      () => ({ ...base(), priceIndex: 1.5 }),
      'priceIndex 1.5 is not an integer >= 1',
    ],
    [
      'negative cash',
      () => patchPlayer(base(), 'p1', { cash: -1 }),
      'player p1: cash -1 is not a non-negative integer',
    ],
    [
      'fractional cash',
      () => patchPlayer(base(), 'p2', { cash: 1.5 }),
      'player p2: cash 1.5 is not a non-negative integer',
    ],
    [
      'negative deposit',
      () => patchPlayer(base(), 'p1', { deposit: -5 }),
      'player p1: deposit -5 is not a non-negative integer',
    ],
    [
      'no dice',
      () => patchPlayer(base(), 'p1', { diceCount: 0 }),
      'player p1: diceCount 0 is outside 1..1 for walk',
    ],
    [
      'more dice than the vehicle allows',
      () => patchPlayer(base(), 'p2', { vehicle: 'motorbike', diceCount: 3 }),
      'player p2: diceCount 3 is outside 1..2 for motorbike',
    ],
    [
      'fractional dice count',
      () => patchPlayer(base(), 'p1', { vehicle: 'car', diceCount: 1.5 }),
      'player p1: diceCount 1.5 is outside 1..3 for car',
    ],
    [
      'unknown vehicle',
      () => patchPlayer(base(), 'p2', { vehicle: 'bicycle' as unknown as Vehicle }),
      'player p2: vehicle bicycle is not a vehicle',
    ],
    [
      'computer without a profile',
      () => patchPlayer(base(), 'p2', { controller: 'computer' }),
      'player p2: a computer without a valid profile',
    ],
    [
      'computer with an invalid profile',
      () =>
        patchPlayer(base(), 'p2', {
          controller: 'computer',
          profile: { cashPercent: 50, loanPercent: 101 },
        }),
      'player p2: a computer without a valid profile',
    ],
    [
      'computer dice count on a human turn',
      () => patchTurn(base(), { phase: { kind: 'awaitRoll', computerDiceCount: 1 } }),
      'phase awaitRoll: computerDiceCount on the turn of p1, who is not a computer',
    ],
    [
      'computer dice count on foot',
      () =>
        patchTurn(patchPlayer(base(), 'p1', COMPUTER), {
          phase: { kind: 'awaitRoll', computerDiceCount: 1 },
        }),
      'phase awaitRoll: computerDiceCount 1 while p1 is on foot',
    ],
    [
      'computer dice count above the limit',
      () =>
        patchTurn(patchPlayer(base(), 'p1', { ...COMPUTER, vehicle: 'motorbike' }), {
          phase: { kind: 'awaitRoll', computerDiceCount: 3 },
        }),
      'phase awaitRoll: computerDiceCount 3 is outside 1..2 for motorbike',
    ],
    [
      'tile off the board',
      () => placePlayer(base(), 'p2', 4, 3),
      'player p2: tile 4 is not on the board',
    ],
    [
      'prev not a neighbour of tile',
      () => placePlayer(base(), 'p1', 0, 2),
      'player p1: prev 2 is not a neighbour of tile 0',
    ],
    [
      'current player off the board',
      () => patchPlayer(base(), 'p1', { location: { kind: 'offBoard' } }),
      'player p1: off the board after their first turn started',
    ],
    [
      'earlier seat off the board',
      () =>
        patchTurn(patchPlayer(base(), 'p1', { location: { kind: 'offBoard' } }), {
          current: 'p2',
        }),
      'player p1: off the board after their first turn started',
    ],
    [
      'later seat off the board after round 1',
      () => patchTurn(patchPlayer(base(), 'p2', { location: { kind: 'offBoard' } }), { round: 2 }),
      'player p2: off the board after their first turn started',
    ],
    [
      'bankrupt player owning land',
      () => patchTile(patchPlayer(base(), 'p2', { bankrupt: true }), 1, { owner: 'p2' }),
      'player p2: bankrupt but owns tiles 1',
    ],
    [
      'level above maxLevel',
      () => patchTile(base(), 1, { owner: 'p1', level: 6 }),
      'tile 1: level 6 is outside 0..5',
    ],
    [
      'negative level',
      () => patchTile(base(), 2, { owner: 'p1', level: -1 }),
      'tile 2: level -1 is outside 0..5',
    ],
    [
      'owner that is not a player',
      () => patchTile(base(), 1, { owner: 'ghost' }),
      'tile 1: owner ghost is not a player',
    ],
    [
      'owned non-property tile',
      () => patchTile(base(), 0, { owner: 'p1' }),
      'tile 0: not a property but has owner p1 and level 0',
    ],
    [
      'built non-property tile',
      () => patchTile(base(), 3, { level: 1 }),
      'tile 3: not a property but has owner null and level 1',
    ],
    [
      'tile states not parallel to the board',
      () => ({ ...base(), tiles: base().tiles.slice(1) }),
      'tiles: 3 entries for 4 board tiles',
    ],
    [
      'unknown current player',
      () => patchTurn(base(), { current: 'ghost' }),
      'turn: current ghost is not a player',
    ],
    [
      'round below 1',
      () => patchTurn(base(), { round: 0 }),
      'turn: round 0 is not a positive integer',
    ],
    [
      'bankrupt current player before the game is over',
      () => patchPlayer(base(), 'p1', { bankrupt: true }),
      'turn: current player p1 is bankrupt',
    ],
    [
      'buy decision away from the current player',
      () => patchTurn(base(), { phase: buy() }),
      'phase awaitBuyDecision: tile 1 is not where p1 stands (0)',
    ],
    [
      'buy decision on a blank tile',
      () => patchTurn(base(), { phase: buy({ tile: 0 }) }),
      'phase awaitBuyDecision: tile 0 is not a property',
    ],
    [
      'buy decision at the wrong price',
      () => deciding(buy({ price: 999 })),
      'phase awaitBuyDecision: price 999 does not match buy price 1000',
    ],
    [
      'buy decision on owned land',
      () => patchTile(deciding(buy()), 1, { owner: 'p2' }),
      'phase awaitBuyDecision: tile 1 is already owned by p2',
    ],
    [
      'upgrade decision away from the current player',
      () => patchTile(patchTurn(base(), { phase: upgrade() }), 1, { owner: 'p1' }),
      'phase awaitUpgradeDecision: tile 1 is not where p1 stands (0)',
    ],
    [
      'upgrade decision on a blank tile',
      () => patchTurn(base(), { phase: upgrade({ tile: 0 }) }),
      'phase awaitUpgradeDecision: tile 0 is not a property',
    ],
    [
      "upgrade decision on someone else's land",
      () => patchTile(deciding(upgrade()), 1, { owner: 'p2' }),
      'phase awaitUpgradeDecision: tile 1 is owned by p2, not p1',
    ],
    [
      'upgrade decision on unowned land',
      () => deciding(upgrade()),
      'phase awaitUpgradeDecision: tile 1 is owned by nobody, not p1',
    ],
    [
      'upgrade decision at maxLevel',
      () => patchTile(deciding(upgrade()), 1, { owner: 'p1', level: 5 }),
      'phase awaitUpgradeDecision: tile 1 is already at maxLevel 5',
    ],
    [
      'upgrade decision at the wrong cost',
      () => patchTile(deciding(upgrade({ cost: 1 })), 1, { owner: 'p1' }),
      'phase awaitUpgradeDecision: cost 1 does not match upgrade cost 500',
    ],
    [
      'bankrupt winner',
      () =>
        patchTurn(patchPlayer(base(), 'p2', { bankrupt: true }), {
          phase: { kind: 'gameOver', winners: ['p2'] },
        }),
      'phase gameOver: winner p2 is bankrupt',
    ],
    [
      'winner that is not a player',
      () => patchTurn(base(), { phase: { kind: 'gameOver', winners: ['ghost'] } }),
      'phase gameOver: winner ghost is not a player',
    ],
  ];

  it.each(cases)('reports %s', (_, build, message) => {
    expect(checkInvariants(build())).toEqual([message]);
  });

  it('reports every violation at once', () => {
    let state = patchPlayer(base(), 'p1', { cash: -1, deposit: -2 });
    state = patchTile(state, 1, { level: 6 });
    state = patchTurn(state, { round: 0 });
    expect(checkInvariants(state)).toEqual([
      'player p1: cash -1 is not a non-negative integer',
      'player p1: deposit -2 is not a non-negative integer',
      'tile 1: level 6 is outside 0..5',
      'turn: round 0 is not a positive integer',
    ]);
  });
});

describe('checkInvariants during an auction', () => {
  const PLOTS = loopBoard([null, 1000, 2000, 1000, 1000, null]);

  /** p1 went bankrupt; p2..p4 (p3 a computer) bid on tile 2 (start 2000) with tile 3 to follow. */
  function auction(patch: Partial<AuctionPhase> = {}): GameState {
    let state = newTestGame({
      board: PLOTS,
      playerCount: 4,
      controllers: ['human', 'human', 'computer', 'human'],
    });
    state = patchPlayer(state, 'p1', { cash: 0, deposit: 0, bankrupt: true });
    const phase: AuctionPhase = {
      kind: 'auction',
      tile: 2,
      queue: [3],
      startPrice: 2000,
      price: 2500,
      leader: 'p2',
      bidder: 'p3',
      bidders: [
        { id: 'p2', status: 'bidding' },
        { id: 'p3', status: 'passed' },
        { id: 'p4', status: 'withdrawn' },
      ],
      computerLimits: { p3: 4000 },
      ...patch,
    };
    return patchTurn(state, { phase });
  }

  it('accepts a consistent auction with a bankrupt current player', () => {
    expect(checkInvariants(auction())).toEqual([]);
    expect(checkInvariants(auction({ price: 2000, leader: null }))).toEqual([]);
  });

  const cases: [string, () => GameState, string][] = [
    [
      'negative lottery pool',
      () => ({ ...auction(), lotteryPool: -1 }),
      'lotteryPool -1 is not a non-negative integer',
    ],
    [
      'owned tile',
      () => patchTile(auction(), 2, { owner: 'p4' }),
      'phase auction: tile 2 is owned by p4',
    ],
    ['blank tile', () => auction({ tile: 0 }), 'phase auction: tile 0 is not a property'],
    [
      'owned queued tile',
      () => patchTile(auction(), 3, { owner: 'p4' }),
      'phase auction: tile 3 is owned by p4',
    ],
    ['repeated tile', () => auction({ queue: [2] }), 'phase auction: tile 2 is drawn twice'],
    [
      'wrong start price',
      () => auction({ startPrice: 1999 }),
      'phase auction: start price 1999 does not match 2000',
    ],
    [
      'leader but no raise',
      () => auction({ price: 2000 }),
      'phase auction: leader p2 but price 2000 is not above the start price',
    ],
    [
      'raise without a leader',
      () => auction({ leader: null }),
      'phase auction: price 2500 is above the start price without a leader',
    ],
    [
      'leader who cannot pay',
      () => patchPlayer(auction(), 'p2', { cash: 2499 }),
      'phase auction: leader p2 has less cash than the price 2500',
    ],
    [
      'bidder is the leader',
      () => auction({ bidder: 'p2' }),
      'phase auction: bidder p2 is the leader',
    ],
    ['bidder withdrew', () => auction({ bidder: 'p4' }), 'phase auction: bidder p4 has withdrawn'],
    [
      'bidder who cannot pay',
      () => patchPlayer(auction(), 'p3', { cash: 2499 }),
      'phase auction: bidder p3 has less cash than the price 2500',
    ],
    [
      'bidder not listed',
      () => auction({ bidder: 'p1' }),
      'phase auction: bidder p1 is not a bidder',
    ],
    [
      'bankrupt bidder',
      () =>
        auction({
          bidders: [
            { id: 'p1', status: 'withdrawn' },
            { id: 'p2', status: 'bidding' },
            { id: 'p3', status: 'passed' },
          ],
        }),
      'phase auction: bidder p1 is bankrupt',
    ],
    [
      'bidders out of seat order',
      () =>
        auction({
          bidders: [
            { id: 'p3', status: 'passed' },
            { id: 'p2', status: 'bidding' },
          ],
        }),
      'phase auction: bidders are not in seat order',
    ],
  ];

  it.each(cases)('reports %s', (_, build, message) => {
    expect(checkInvariants(build())).toEqual([message]);
  });

  it('reports computer limits that do not match the computer bidders', () => {
    expect(checkInvariants(auction({ computerLimits: {} }))).toEqual([
      'phase auction: computer bidder p3 has no limit',
    ]);
    expect(checkInvariants(auction({ computerLimits: { p2: 100, p3: 4000 } }))).toEqual([
      'phase auction: p2 has a computer limit but is not a computer bidder',
    ]);
    expect(checkInvariants(auction({ computerLimits: { p3: -1 } }))).toEqual([
      'phase auction: computer limit -1 of p3 is not a non-negative integer',
    ]);
  });
});
