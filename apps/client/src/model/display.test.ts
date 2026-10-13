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
  return { id, name: id, cash: 1000, deposit: 500, position: 0, bankrupt: false, ...patch };
}

function model(): DisplayModel {
  return {
    round: 1,
    current: 'a',
    players: [player('a'), player('b')],
    tiles: [
      { owner: null, level: 0 },
      { owner: null, level: 0 },
      { owner: 'a', level: 2 },
    ],
    winners: null,
  };
}

function apply(...events: GameEvent[]): DisplayModel {
  return events.reduce(applyEventToDisplay, model());
}

describe('applyEventToDisplay', () => {
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
    expect(next.players[1]?.position).toBe(2);
    expect(next.players[0]?.position).toBe(0);
  });

  it('PassBonusReceived adds cash', () => {
    const next = apply({ type: 'PassBonusReceived', playerId: 'a', tile: 0, amount: 200 });
    expect(next.players[0]?.cash).toBe(1200);
  });

  it('DepositWithdrawn then a payment nets to cash first, then deposit', () => {
    const next = apply(
      { type: 'DepositWithdrawn', playerId: 'a', amount: 300 },
      { type: 'PropertyBought', playerId: 'a', tile: 1, price: 1300 },
    );
    expect(next.players[0]).toMatchObject({ cash: 0, deposit: 200 });
    expect(next.tiles[1]).toEqual({ owner: 'a', level: 0 });
  });

  it('PropertyUpgraded pays the cost and sets the level', () => {
    const next = apply({ type: 'PropertyUpgraded', playerId: 'a', tile: 2, level: 3, cost: 400 });
    expect(next.players[0]?.cash).toBe(600);
    expect(next.tiles[2]).toEqual({ owner: 'a', level: 3 });
  });

  it('RentPaid moves cash between players', () => {
    const next = apply({ type: 'RentPaid', from: 'b', to: 'a', tile: 2, amount: 250 });
    expect(next.players[0]?.cash).toBe(1250);
    expect(next.players[1]?.cash).toBe(750);
  });

  it('PlayerBankrupt zeroes money, releases tiles and pays the creditor', () => {
    const next = apply({
      type: 'PlayerBankrupt',
      playerId: 'a',
      creditor: 'b',
      paidToCreditor: 1500,
      releasedTiles: [2],
      cause: { kind: 'rent', tile: 2, amountDue: 9000 },
    });
    expect(next.players[0]).toMatchObject({ cash: 0, deposit: 0, bankrupt: true });
    expect(next.players[1]?.cash).toBe(2500);
    expect(next.tiles[2]).toEqual({ owner: null, level: 0 });
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
      reason: 'roundLimit',
      winners: ['b'],
      totalAssets: {},
    });
    expect(next.winners).toEqual(['b']);
  });

  it('does not modify its input', () => {
    const before = model();
    const copy = JSON.parse(JSON.stringify(before)) as DisplayModel;
    applyEventToDisplay(before, { type: 'RentPaid', from: 'b', to: 'a', tile: 2, amount: 250 });
    expect(before).toEqual(copy);
  });
});

describe('diffDisplay', () => {
  it('is empty for equal models and names each differing field', () => {
    expect(diffDisplay(model(), model())).toEqual([]);
    const changed = apply({ type: 'RentPaid', from: 'b', to: 'a', tile: 2, amount: 1 });
    expect(diffDisplay(changed, model())).toEqual([
      'players[0].cash: 1001 != 1000',
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
    ['round limit', hotSeatSetup(21)],
    ['last standing', hotSeatSetup(22, 'lastStanding')],
    ['pass bonus', withConfig(hotSeatSetup(23), { passStartBonus: 500 })],
    [
      'cash and deposit, low cash',
      withConfig(hotSeatSetup(24, 'lastStanding'), {
        purchaseFunds: 'cashAndDeposit',
        startingCash: 2000,
      }),
    ],
    ['full payout', withConfig(hotSeatSetup(25, 'lastStanding'), { bankruptcyPayout: 'full' })],
    ['no payout', withConfig(hotSeatSetup(26, 'lastStanding'), { bankruptcyPayout: 'none' })],
    ['two players', hotSeatSetup(27, 'lastStanding', 2)],
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

  it('covers bankruptcies and deposit withdrawals somewhere in these games', () => {
    const types = new Set(
      cases.flatMap(([, setup]) =>
        playRandomGame(setup, 200_000).flatMap((u) => u.events.map((e) => e.type)),
      ),
    );
    expect(types).toContain('PlayerBankrupt');
    expect(types).toContain('DepositWithdrawn');
    expect(types).toContain('PassBonusReceived');
    expect(types).toContain('PropertyUpgraded');
  });
});
