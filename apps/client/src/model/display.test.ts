import type { GameEvent, GameSetup, RuleConfig } from '@richman/shared';
import { describe, expect, it } from 'vitest';
import { hotSeatSetup, playRandomGame } from '../testing/random-game';
import {
  applyEventToDisplay,
  diffDisplay,
  displayFromView,
  type DisplayModel,
  type DisplayPlayer,
} from './display';

function player(id: string, patch: Partial<DisplayPlayer> = {}): DisplayPlayer {
  return {
    id,
    name: id,
    cash: 1000,
    deposit: 500,
    tile: 0,
    vehicle: 'walk',
    diceCount: 1,
    bankrupt: false,
    ...patch,
  };
}

function model(): DisplayModel {
  return {
    round: 1,
    day: 0,
    date: { year: 2010, month: 1, day: 1 },
    priceIndex: 1,
    current: 'a',
    players: [player('a'), player('b')],
    tiles: [
      { owner: null, level: 0 },
      { owner: null, level: 0 },
      { owner: 'a', level: 2 },
    ],
    auction: null,
    winners: null,
  };
}

function apply(...events: GameEvent[]): DisplayModel {
  return events.reduce(applyEventToDisplay, model());
}

describe('applyEventToDisplay', () => {
  it('DiceCountSet changes the dice count of that player only', () => {
    const next = apply({ type: 'DiceCountSet', playerId: 'b', count: 3 });
    expect(next.players.map((p) => p.diceCount)).toEqual([1, 3]);
  });

  it('DayAdvanced sets the day and the price index', () => {
    const next = apply({
      type: 'DayAdvanced',
      day: 4,
      date: { year: 2010, month: 1, day: 5 },
      priceIndex: 3,
    });
    expect(next).toMatchObject({ day: 4, priceIndex: 3 });
  });

  it('TurnStarted sets the current player and round', () => {
    const next = apply({ type: 'TurnStarted', playerId: 'b', round: 3 });
    expect(next.current).toBe('b');
    expect(next.round).toBe(3);
  });

  it('DiceRolled changes nothing', () => {
    const before = model();
    expect(
      applyEventToDisplay(before, { type: 'DiceRolled', playerId: 'a', dice: [3], total: 3 }),
    ).toEqual(before);
  });

  it('PlayerMoved puts the player on the last tile of the path', () => {
    const next = apply({ type: 'PlayerMoved', playerId: 'b', path: [1, 2] });
    expect(next.players[1]?.tile).toBe(2);
    expect(next.players[0]?.tile).toBe(0);
  });

  it('PlayerPlaced puts an unplaced player on the board', () => {
    const before: DisplayModel = {
      ...model(),
      players: [player('a'), player('b', { tile: null })],
    };
    const next = applyEventToDisplay(before, {
      type: 'PlayerPlaced',
      playerId: 'b',
      tile: 2,
      prev: 1,
    });
    expect(next.players.map((p) => p.tile)).toEqual([0, 2]);
  });

  it('DepositWithdrawn then a payment nets to cash first, then deposit', () => {
    const next = apply(
      { type: 'DepositWithdrawn', playerId: 'a', amount: 300 },
      { type: 'PropertyBought', playerId: 'a', tile: 1, price: 1300 },
    );
    expect(next.players[0]).toMatchObject({ cash: 0, deposit: 200 });
    expect(next.tiles[1]).toEqual({ owner: 'a', level: 0 });
  });

  it('BankTransferred moves money either way; BankOpened changes nothing', () => {
    const withdrew = apply(
      { type: 'BankOpened', playerId: 'a', tile: 1, trigger: 'pass' },
      { type: 'BankTransferred', playerId: 'a', direction: 'withdraw', amount: 300 },
    );
    expect(withdrew.players[0]).toMatchObject({ cash: 1300, deposit: 200 });
    const deposited = apply({
      type: 'BankTransferred',
      playerId: 'a',
      direction: 'deposit',
      amount: 400,
    });
    expect(deposited.players[0]).toMatchObject({ cash: 600, deposit: 900 });
  });

  it('BankRebalanced sets the new cash and deposit', () => {
    const next = apply({
      type: 'BankRebalanced',
      playerId: 'a',
      tile: 1,
      cash: 1125,
      deposit: 375,
    });
    expect(next.players[0]).toMatchObject({ cash: 1125, deposit: 375 });
  });

  it('PropertyUpgraded pays the cost and sets the level', () => {
    const next = apply({ type: 'PropertyUpgraded', playerId: 'a', tile: 2, level: 3, cost: 400 });
    expect(next.players[0]?.cash).toBe(600);
    expect(next.tiles[2]).toEqual({ owner: 'a', level: 3 });
  });

  it("RentPaid moves money from the payer's cash into the owner's deposit", () => {
    const next = apply({
      type: 'RentPaid',
      from: 'b',
      to: 'a',
      tile: 2,
      amount: 250,
      into: 'deposit',
    });
    expect(next.players[0]).toMatchObject({ cash: 1000, deposit: 750 });
    expect(next.players[1]).toMatchObject({ cash: 750, deposit: 500 });
  });

  it('AuctionWon takes the price from cash and hands over the tile with its buildings', () => {
    const before: DisplayModel = {
      ...model(),
      tiles: [...model().tiles.slice(0, 2), { owner: null, level: 3 }],
    };
    const next = applyEventToDisplay(before, {
      type: 'AuctionWon',
      playerId: 'b',
      tile: 2,
      price: 700,
    });
    expect(next.players[1]).toMatchObject({ cash: 300, deposit: 500 });
    expect(next.tiles[2]).toEqual({ owner: 'b', level: 3 });
  });

  it('follows an auction from its opening to the end', () => {
    let next = apply({
      type: 'AuctionStarted',
      tile: 2,
      startPrice: 100,
      bidders: ['a', 'b'],
      remaining: 1,
    });
    expect(next.auction).toEqual({
      tile: 2,
      startPrice: 100,
      price: 100,
      leader: null,
      bidders: [
        { id: 'a', status: 'bidding' },
        { id: 'b', status: 'bidding' },
      ],
      remaining: 1,
    });
    next = applyEventToDisplay(next, { type: 'AuctionPassed', playerId: 'a' });
    expect(next.auction?.bidders[0]).toEqual({ id: 'a', status: 'passed' });
    next = applyEventToDisplay(next, {
      type: 'AuctionRaised',
      playerId: 'b',
      raise: 500,
      price: 600,
    });
    expect(next.auction).toMatchObject({
      price: 600,
      leader: 'b',
      bidders: [
        { id: 'a', status: 'bidding' },
        { id: 'b', status: 'bidding' },
      ],
    });
    next = applyEventToDisplay(next, {
      type: 'AuctionWithdrawn',
      playerId: 'a',
      reason: 'shortOfCash',
    });
    expect(next.auction?.bidders[0]).toEqual({ id: 'a', status: 'withdrawn' });
    // The players' money only changes with the sale.
    expect(next.players).toEqual(model().players);
    expect(applyEventToDisplay(next, { type: 'AuctionUnsold', tile: 2 }).auction).toBeNull();
    expect(
      applyEventToDisplay(next, { type: 'AuctionWon', playerId: 'b', tile: 2, price: 600 }).auction,
    ).toBeNull();
  });

  it('PropertyBought keeps the buildings of a released tile', () => {
    const before: DisplayModel = {
      ...model(),
      tiles: [...model().tiles.slice(0, 2), { owner: null, level: 3 }],
    };
    const next = applyEventToDisplay(before, {
      type: 'PropertyBought',
      playerId: 'b',
      tile: 2,
      price: 700,
    });
    expect(next.tiles[2]).toEqual({ owner: 'b', level: 3 });
  });

  it("PlayerBankrupt zeroes money, releases tiles with their buildings and pays into the creditor's deposit", () => {
    const next = apply({
      type: 'PlayerBankrupt',
      playerId: 'a',
      creditor: 'b',
      paidToCreditor: 1500,
      releasedTiles: [2],
      cause: { kind: 'rent', tile: 2, amountDue: 9000 },
    });
    expect(next.players[0]).toMatchObject({ cash: 0, deposit: 0, bankrupt: true });
    expect(next.players[1]).toMatchObject({ cash: 1000, deposit: 2000 });
    expect(next.tiles[2]).toEqual({ owner: null, level: 2 });
  });

  it('PlayerBankrupt owed to the system pays nobody', () => {
    const next = apply({
      type: 'PlayerBankrupt',
      playerId: 'a',
      creditor: null,
      paidToCreditor: 0,
      releasedTiles: [],
      cause: { kind: 'system', amountDue: 9000 },
    });
    expect(next.players[1]?.cash).toBe(1000);
  });

  it('GameEnded records the winners', () => {
    const next = apply({
      type: 'GameEnded',
      reason: 'dayLimitOrNetWorthTarget',
      winners: ['b'],
      netWorth: {},
    });
    expect(next.winners).toEqual(['b']);
  });

  it('does not modify its input', () => {
    const before = model();
    const copy = JSON.parse(JSON.stringify(before)) as DisplayModel;
    applyEventToDisplay(before, {
      type: 'RentPaid',
      from: 'b',
      to: 'a',
      tile: 2,
      amount: 250,
      into: 'deposit',
    });
    expect(before).toEqual(copy);
  });
});

describe('diffDisplay', () => {
  it('is empty for equal models and names each differing field', () => {
    expect(diffDisplay(model(), model())).toEqual([]);
    const changed = apply({
      type: 'RentPaid',
      from: 'b',
      to: 'a',
      tile: 2,
      amount: 1,
      into: 'deposit',
    });
    expect(diffDisplay(changed, model())).toEqual([
      'players[0].deposit: 501 != 500',
      'players[1].cash: 999 != 1000',
    ]);
  });
});

function withConfig(setup: GameSetup, patch: Partial<RuleConfig>): GameSetup {
  return { ...setup, config: { ...setup.config, ...patch } };
}

// Folding every event onto the previous view must reproduce the next view; a mismatch means an
// event does not carry enough information for the screen.
describe('events reproduce the views', () => {
  const cases: [string, GameSetup][] = [
    ['day limit', hotSeatSetup(21)],
    ['last standing', hotSeatSetup(22, 'lastStanding')],
    ['low cash', withConfig(hotSeatSetup(24, 'lastStanding'), { startingFunds: 4000 })],
    ['two players', hotSeatSetup(27, 'lastStanding', 2)],
    [
      'cars with computers',
      withConfig(hotSeatSetup(28, 'dayLimit', 4, ['human', 'computer', 'human', 'computer']), {
        startingVehicle: 'car',
      }),
    ],
  ];

  it.each(cases)('%s', (_, setup) => {
    const updates = playRandomGame(setup, 200_000);
    let shown: DisplayModel | null = null;
    for (const [i, update] of updates.entries()) {
      const expected = displayFromView(update.view);
      // The opening update has nothing before it; start from its own view minus its events.
      shown ??= expected;
      if (i > 0) shown = update.events.reduce(applyEventToDisplay, shown);
      expect(diffDisplay(shown, expected), `update ${i}`).toEqual([]);
    }
    expect(updates.some((u) => u.events.some((e) => e.type === 'GameEnded'))).toBe(true);
  });

  it('covers bankruptcies, deposit withdrawals and placement somewhere in these games', () => {
    const types = new Set(
      cases.flatMap(([, setup]) =>
        playRandomGame(setup, 200_000).flatMap((u) => u.events.map((e) => e.type)),
      ),
    );
    expect(types).toContain('PlayerBankrupt');
    expect(types).toContain('DepositWithdrawn');
    expect(types).toContain('PlayerPlaced');
    expect(types).toContain('PropertyUpgraded');
    expect(types).toContain('DayAdvanced');
    expect(types).toContain('DiceCountSet');
  });
});
