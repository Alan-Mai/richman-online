import { describe, expect, it } from 'vitest';
import type { Action } from './actions';
import { DEFAULT_RULE_CONFIG, type RuleConfig } from './config';
import type { GameEvent } from './events';
import { buyPrice, netWorth, rentFor, totalAssets, upgradeCost } from './money';
import type { GameState } from './state';
import {
  applyOk,
  getPlayer,
  loopBoard,
  newTestGame,
  patchPlayer,
  patchTile,
  withFixedDice,
} from './testing';
import { viewFor } from './view';

const FUNDS = 10_000;
const BLANK_BOARD = loopBoard([null, null, null, null, null, null]);
const AMOUNTS = { price: 1000, upgradeCost: 300, rents: [100, 200, 300, 400, 500, 600] };
/** Tiles 1 and 2 are properties on the same street. */
const BOARD = loopBoard([
  null,
  { ...AMOUNTS, name: 'S' },
  { ...AMOUNTS, name: 'S' },
  null,
  null,
  null,
]);

const roll = (playerId: string): Action => ({ type: 'rollDice', playerId });

function game(options: { playerCount?: number; config?: Partial<RuleConfig> } = {}): GameState {
  return newTestGame({
    board: BLANK_BOARD,
    ...options,
    config: { startingFunds: FUNDS, ...options.config },
  });
}

/** Sets cash and deposit of each listed player. */
function withMoney(state: GameState, money: Record<string, [number, number]>): GameState {
  return Object.entries(money).reduce(
    (s, [id, [cash, deposit]]) => patchPlayer(s, id, { cash, deposit }),
    state,
  );
}

/** The current player rolls a 1 onto a blank tile, ending their turn. */
function pass(state: GameState) {
  return applyOk(withFixedDice(state, [1]), roll(state.turn.current));
}

const withIndex = (state: GameState, priceIndex: number): GameState => ({ ...state, priceIndex });

describe('starting funds', () => {
  it('gives half as cash and half as deposit', () => {
    const state = game();
    for (const player of state.players) {
      expect(player).toMatchObject({ cash: FUNDS / 2, deposit: FUNDS / 2 });
    }
  });

  it('drops the odd one: cash = deposit = floor(funds / 2)', () => {
    const state = game({ config: { startingFunds: 1001 } });
    for (const player of state.players) {
      expect(player).toMatchObject({ cash: 500, deposit: 500 });
      expect(player.cash + player.deposit).toBe(1000);
    }
  });

  it('is a positive integer', () => {
    for (const startingFunds of [0, -2, 1.5]) {
      expect(
        newTestGame.bind(null, { config: { startingFunds } }),
        `startingFunds ${startingFunds}`,
      ).toThrow(/startingFunds/);
    }
  });

  it('replaces startingCash and startingDeposit', () => {
    // @ts-expect-error startingCash no longer exists
    const cash: RuleConfig = { ...DEFAULT_RULE_CONFIG, startingCash: 1 };
    // @ts-expect-error startingDeposit no longer exists
    const deposit: RuleConfig = { ...DEFAULT_RULE_CONFIG, startingDeposit: 1 };
    expect(cash).toBeDefined();
    expect(deposit).toBeDefined();
    expect(Object.keys(DEFAULT_RULE_CONFIG)).not.toContain('startingCash');
    expect(Object.keys(DEFAULT_RULE_CONFIG)).not.toContain('startingDeposit');
  });
});

describe('a new game', () => {
  it('starts on day 0 with price index 1', () => {
    expect(game()).toMatchObject({ day: 0, priceIndex: 1 });
  });
});

describe('the day', () => {
  it('does not advance within a round', () => {
    const { state, events } = pass(game({ playerCount: 3 }));
    expect(state.day).toBe(0);
    expect(events.map((e) => e.type)).not.toContain('DayAdvanced');
    const second = pass(state);
    expect(second.state.day).toBe(0);
  });

  it("advances after the last seat's turn, before seat 0's turn starts", () => {
    const afterP1 = pass(game()).state;
    const { state, events } = pass(afterP1);
    expect(state.day).toBe(1);
    expect(events.slice(-2)).toEqual([
      { type: 'DayAdvanced', day: 1, priceIndex: 1 },
      { type: 'TurnStarted', playerId: 'p1', round: 2 },
    ]);
  });

  it('advances once per round', () => {
    let state = game();
    for (let i = 0; i < 6; i++) state = pass(state).state;
    expect(state).toMatchObject({ day: 3, turn: { round: 4 } });
  });

  it('still advances when seat 0 is bankrupt', () => {
    let state = patchPlayer(game({ playerCount: 3 }), 'p1', { bankrupt: true });
    state = { ...state, turn: { ...state.turn, current: 'p3' } };
    const { state: next, events } = pass(state);
    expect(next.day).toBe(1);
    expect(events.slice(-2)).toEqual([
      { type: 'DayAdvanced', day: 1, priceIndex: 1 },
      { type: 'TurnStarted', playerId: 'p2', round: 2 },
    ]);
  });
});

describe('the price index', () => {
  /** p2 is about to end round 1. */
  function endOfRound(
    money: Record<string, [number, number]>,
    playerCount = 2,
    board = BLANK_BOARD,
  ): GameState {
    let state = withMoney(
      newTestGame({ board, playerCount, config: { startingFunds: FUNDS } }),
      money,
    );
    for (let seat = 1; seat < playerCount; seat++) {
      state = { ...state, turn: { ...state.turn, current: `p${seat + 1}` } };
    }
    return state;
  }

  const dayAdvanced = (events: GameEvent[]) => events.find((e) => e.type === 'DayAdvanced');

  it('becomes floor(average net worth / starting funds)', () => {
    // Net worths 25,000 and 34,999: average 29,999 -> 2.
    const { state, events } = pass(endOfRound({ p1: [20_000, 5000], p2: [30_000, 4999] }));
    expect(state.priceIndex).toBe(2);
    expect(dayAdvanced(events)).toEqual({ type: 'DayAdvanced', day: 1, priceIndex: 2 });
  });

  it('stays at 1 below twice the starting funds', () => {
    const { state } = pass(endOfRound({ p1: [10_000, 9999], p2: [10_000, 9999] }));
    expect(state.priceIndex).toBe(1);
  });

  it('counts owned properties at their unindexed value', () => {
    let start = endOfRound({ p1: [9000, 0], p2: [49_399, 0] }, 2, BOARD);
    start = withIndex(patchTile(start, 1, { owner: 'p1', level: 2 }), 2);
    // p2 rolls a 3 onto blank tile 3, paying no rent.
    const passOnBlank = (state: GameState) => applyOk(withFixedDice(state, [3]), roll('p2'));
    // p1: 9000 + 1000 + 2 * 300 = 10,600; average (10,600 + 49,399) / 2 = 29,999 -> 2.
    // Counted at index 2 the tile would be worth 3200 and the average 30,799 -> 3.
    expect(passOnBlank(start).state.priceIndex).toBe(2);
    start = patchPlayer(start, 'p2', { cash: 49_401 });
    // average (10,600 + 49,401) / 2 = 30,000 -> 3.
    expect(passOnBlank(start).state.priceIndex).toBe(3);
  });

  it('never falls', () => {
    const start = withIndex(endOfRound({ p1: [100, 0], p2: [100, 0] }), 3);
    const { state, events } = pass(start);
    expect(state.priceIndex).toBe(3);
    expect(dayAdvanced(events)).toEqual({ type: 'DayAdvanced', day: 1, priceIndex: 3 });
  });

  it('leaves bankrupt players out of the average', () => {
    let start = endOfRound({ p1: [30_000, 0], p2: [30_000, 0], p3: [0, 0] }, 3);
    start = patchPlayer(start, 'p2', { bankrupt: true });
    // Only p1 and p3 count: average 15,000 -> 1. With p2 it would be 20,000 -> 2.
    expect(pass(start).state.priceIndex).toBe(1);
  });

  it('divides by the starting funds, not the cash and deposit dealt from them', () => {
    // 1001 is dealt as 500 + 500; average 2000 / 1001 -> 1, whereas / 1000 would give 2.
    let start = newTestGame({ board: BLANK_BOARD, config: { startingFunds: 1001 } });
    start = withMoney(start, { p1: [2000, 0], p2: [2000, 0] });
    start = { ...start, turn: { ...start.turn, current: 'p2' } };
    expect(pass(start).state.priceIndex).toBe(1);
  });
});

describe('prices under the price index', () => {
  const base = withIndex(newTestGame({ board: BOARD }), 3);

  it('multiplies the buy price, buildings included', () => {
    expect(buyPrice(base, 1)).toBe(3 * 1000);
    expect(buyPrice(patchTile(base, 1, { level: 2 }), 1)).toBe(3 * (1000 + 2 * 300));
  });

  it('multiplies the upgrade cost', () => {
    expect(upgradeCost(patchTile(base, 1, { owner: 'p1' }), 1)).toBe(3 * 300);
  });

  it('multiplies the street rent', () => {
    let state = patchTile(base, 1, { owner: 'p2', level: 1 });
    state = patchTile(state, 2, { owner: 'p2', level: 3 });
    expect(rentFor(state, 1)).toBe(3 * (200 + 400));
  });

  it('is what the engine offers and charges', () => {
    const offered = applyOk(withFixedDice(patchPlayer(base, 'p1', { cash: 1e6 }), [1]), roll('p1'));
    expect(offered.state.turn.phase).toEqual({ kind: 'awaitBuyDecision', tile: 1, price: 3000 });

    let own = patchTile(base, 1, { owner: 'p1', level: 1 });
    own = withFixedDice(patchPlayer(own, 'p1', { cash: 1e6 }), [1]);
    expect(applyOk(own, roll('p1')).state.turn.phase).toEqual({
      kind: 'awaitUpgradeDecision',
      tile: 1,
      cost: 900,
    });

    let rent = patchTile(base, 1, { owner: 'p2', level: 0 });
    rent = withFixedDice(patchPlayer(rent, 'p1', { cash: 1e6, deposit: 0 }), [1]);
    const { state, events } = applyOk(rent, roll('p1'));
    expect(events).toContainEqual({
      type: 'RentPaid',
      from: 'p1',
      to: 'p2',
      tile: 1,
      amount: 300,
      into: 'deposit',
    });
    expect(getPlayer(state, 'p1').cash).toBe(1e6 - 300);
  });
});

describe('netWorth', () => {
  it('adds cash, deposit and each owned property at land price plus built levels', () => {
    let state = patchPlayer(newTestGame({ board: BOARD }), 'p1', { cash: 7, deposit: 11 });
    state = patchTile(state, 1, { owner: 'p1', level: 2 });
    state = patchTile(state, 2, { owner: 'p2', level: 5 });
    expect(netWorth(state, 'p1')).toBe(7 + 11 + 1000 + 2 * 300);
  });

  it('does not multiply properties by the price index, unlike totalAssets', () => {
    let state = patchPlayer(newTestGame({ board: BOARD }), 'p1', { cash: 7, deposit: 11 });
    state = withIndex(patchTile(state, 1, { owner: 'p1', level: 2 }), 4);
    expect(netWorth(state, 'p1')).toBe(7 + 11 + 1000 + 2 * 300);
    expect(totalAssets(state, 'p1')).toBe(7 + 11 + 4 * (1000 + 2 * 300));
  });
});

describe('viewFor', () => {
  it('sends the day and the price index', () => {
    const state = { ...game(), day: 12, priceIndex: 5 };
    expect(viewFor(state, { kind: 'player', id: 'p1' })).toMatchObject({ day: 12, priceIndex: 5 });
    expect(viewFor(state, { kind: 'spectator' })).toMatchObject({ day: 12, priceIndex: 5 });
  });
});
