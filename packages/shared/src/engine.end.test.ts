import { describe, expect, it } from 'vitest';
import type { Action } from './actions';
import type { RuleConfig } from './config';
import { applyAction, legalActions } from './engine';
import type { GameEvent } from './events';
import { netWorth } from './money';
import type { GameState } from './state';
import {
  applyOk,
  getPlayer,
  loopBoard,
  newTestGame,
  patchPlayer,
  patchTile,
  patchTurn,
  withFixedDice,
} from './testing';
import { viewFor } from './view';

const PRICE = 1001;
/** Tile 1 and 2 are properties; the rest are blank. */
const BOARD = loopBoard([null, PRICE, 2000, null, null, null]);
const BLANK_BOARD = loopBoard([null, null, null, null, null, null]);
const FUNDS = 10_000;

const roll = (playerId: string): Action => ({ type: 'rollDice', playerId });

/** Rolls a 1 for whoever is current. */
function rollOne(state: GameState) {
  return applyOk(withFixedDice(state, [1]), roll(state.turn.current));
}

/** Sets cash and clears deposit for each listed player. */
function withCash(state: GameState, cash: Record<string, number>): GameState {
  return Object.entries(cash).reduce(
    (s, [id, amount]) => patchPlayer(s, id, { cash: amount, deposit: 0 }),
    state,
  );
}

/** The last event, asserted to be GameEnded. */
function gameEnded(events: GameEvent[]) {
  const last = events.at(-1);
  expect(last?.type).toBe('GameEnded');
  if (last?.type !== 'GameEnded') throw new Error('unreachable after the assertion');
  return last;
}

const endedBy = (events: GameEvent[]) => events.find((e) => e.type === 'GameEnded');

describe('lastStanding', () => {
  /** p1 rolls onto p2's tile 1 with too little money. */
  function fatalLanding(options: { playerCount?: number; config?: Partial<RuleConfig> } = {}) {
    let state = newTestGame({ board: BOARD, ...options });
    state = patchTile(state, 1, { owner: 'p2', level: 0 });
    state = withCash(state, { p1: 1, p2: 50 });
    return state;
  }

  it('ends the game at once when one of the last two goes bankrupt', () => {
    const start = fatalLanding();
    const { state, events } = rollOne(start);
    expect(events.slice(2).map((e) => e.type)).toEqual(['PlayerBankrupt', 'GameEnded']);
    // p2 received p1's last 1 into the deposit.
    expect(gameEnded(events)).toEqual({
      type: 'GameEnded',
      reason: 'lastStanding',
      winners: ['p2'],
      netWorth: { p1: 0, p2: 51 + PRICE },
    });
    expect(events.map((e) => e.type)).not.toContain('TurnStarted');
    expect(state.turn).toEqual({
      current: 'p1',
      round: 1,
      phase: { kind: 'gameOver', winners: ['p2'] },
    });
  });

  it('keeps playing while two or more remain', () => {
    const { state, events } = rollOne(fatalLanding({ playerCount: 3 }));
    expect(events.at(-1)).toEqual({ type: 'TurnStarted', playerId: 'p2', round: 1 });
    expect(state.turn.phase.kind).toBe('awaitRoll');
  });

  it('still ends at once, mid-round, with a day limit and a net worth target set', () => {
    const config = { dayLimit: 50, netWorthTargetMultiple: 3 };
    const { events } = rollOne(fatalLanding({ config }));
    expect(gameEnded(events)).toMatchObject({ reason: 'lastStanding', winners: ['p2'] });
    expect(events.map((e) => e.type)).not.toContain('DayAdvanced');
  });

  it('handles nobody left standing (defensive: later effects may bankrupt several at once)', () => {
    let state = newTestGame({ board: BOARD, playerCount: 3 });
    for (const id of ['p1', 'p2', 'p3']) state = patchPlayer(state, id, { bankrupt: true });
    state = patchTurn(state, { phase: { kind: 'awaitBuyDecision', tile: 1, price: PRICE } });
    const { state: after, events } = applyOk(state, { type: 'decline', playerId: 'p1' });
    expect(events).toEqual([
      {
        type: 'GameEnded',
        reason: 'lastStanding',
        winners: [],
        netWorth: {
          p1: netWorth(state, 'p1'),
          p2: netWorth(state, 'p2'),
          p3: netWorth(state, 'p3'),
        },
      },
    ]);
    expect(after.turn.phase).toEqual({ kind: 'gameOver', winners: [] });
  });
});

/** A game on `board` (blank by default) where the last seat is about to end day `day + 1`. */
function endOfDay(options: {
  playerCount?: number;
  config?: Partial<RuleConfig>;
  cash?: Record<string, number>;
  day?: number;
  board?: typeof BOARD;
}): GameState {
  const playerCount = options.playerCount ?? 2;
  let state = newTestGame({
    board: options.board ?? BLANK_BOARD,
    playerCount,
    config: { startingFunds: FUNDS, ...options.config },
  });
  state = withCash(state, options.cash ?? {});
  const day = options.day ?? 0;
  return { ...patchTurn(state, { current: `p${playerCount}`, round: day + 1 }), day };
}

/** The last seat rolls a 3, from tile 0 onto blank tile 3 of BOARD (or any tile of BLANK_BOARD). */
function lastSeatRollsThree(state: GameState) {
  return applyOk(withFixedDice(state, [3]), roll(state.turn.current));
}

describe('without a day limit or net worth target (the defaults)', () => {
  it('never ends by days or wealth', () => {
    let state = withCash(newTestGame({ board: BLANK_BOARD }), { p1: 1e9, p2: 1e9 });
    for (let i = 0; i < 40; i++) state = rollOne(state).state;
    expect(state).toMatchObject({ day: 20, turn: { round: 21, phase: { kind: 'awaitRoll' } } });
  });
});

describe('day limit', () => {
  it('ends the game on the day it is reached, not the day before', () => {
    let state = newTestGame({ board: BLANK_BOARD, config: { dayLimit: 2 } });
    state = rollOne(rollOne(state).state).state;
    expect(state).toMatchObject({ day: 1, turn: { phase: { kind: 'awaitRoll' } } });
    state = rollOne(state).state;
    const { state: after, events } = rollOne(state);
    expect(events.slice(-2).map((e) => e.type)).toEqual(['DayAdvanced', 'GameEnded']);
    expect(gameEnded(events).reason).toBe('dayLimitOrNetWorthTarget');
    expect(events.map((e) => e.type)).not.toContain('TurnStarted');
    expect(after).toMatchObject({ day: 2, turn: { round: 2, phase: { kind: 'gameOver' } } });
  });

  it('gives the win to the highest net worth only', () => {
    const cash = { p1: 5, p2: 6, p3: 4 };
    const { state, events } = rollOne(endOfDay({ playerCount: 3, config: { dayLimit: 1 }, cash }));
    expect(gameEnded(events)).toMatchObject({
      reason: 'dayLimitOrNetWorthTarget',
      winners: ['p2'],
    });
    expect(state.turn.phase).toEqual({ kind: 'gameOver', winners: ['p2'] });
  });

  it('breaks a tie by seat order: the earlier seat wins alone', () => {
    const cash = { p1: 3, p2: 7, p3: 7 };
    const { events } = rollOne(endOfDay({ playerCount: 3, config: { dayLimit: 1 }, cash }));
    expect(gameEnded(events).winners).toEqual(['p2']);
  });

  it('compares properties at their unindexed value', () => {
    let start = endOfDay({ config: { dayLimit: 1 }, cash: { p1: 1000, p2: 3500 }, board: BOARD });
    start = patchTile({ ...start, priceIndex: 3 }, 2, { owner: 'p1', level: 0 });
    // p1: 1000 + 2000 = 3000 < 3500. At index 3 p1's tile would count 6000 and p1 would win.
    const { events } = lastSeatRollsThree(start);
    expect(gameEnded(events)).toMatchObject({
      winners: ['p2'],
      netWorth: { p1: 3000, p2: 3500 },
    });
  });

  it('leaves bankrupt players out', () => {
    const cash = { p1: 1, p2: 9, p3: 2 };
    let start = endOfDay({ playerCount: 3, config: { dayLimit: 1 }, cash });
    start = patchPlayer(start, 'p2', { bankrupt: true });
    expect(gameEnded(rollOne(start).events).winners).toEqual(['p3']);
  });

  it('does not end the game while the best net worth is 0', () => {
    const start = endOfDay({ config: { dayLimit: 1 }, cash: { p1: 0, p2: 0 } });
    const { state, events } = rollOne(start);
    expect(endedBy(events)).toBeUndefined();
    expect(state).toMatchObject({ day: 1, turn: { current: 'p1', phase: { kind: 'awaitRoll' } } });
    // A later day ends it once someone is worth anything.
    const later = endOfDay({ config: { dayLimit: 1 }, cash: { p1: 0, p2: 1 }, day: 1 });
    expect(gameEnded(rollOne(later).events)).toMatchObject({
      reason: 'dayLimitOrNetWorthTarget',
      winners: ['p2'],
    });
  });

  it('ends before the price index is updated', () => {
    // Average net worth 30,000 would raise the index to 3.
    const cash = { p1: 30_000, p2: 30_000 };
    const { state, events } = rollOne(endOfDay({ config: { dayLimit: 1 }, cash }));
    expect(events.find((e) => e.type === 'DayAdvanced')).toEqual({
      type: 'DayAdvanced',
      day: 1,
      priceIndex: 1,
    });
    expect(state.priceIndex).toBe(1);
    expect(gameEnded(events).reason).toBe('dayLimitOrNetWorthTarget');
  });
});

describe('net worth target', () => {
  const config = { netWorthTargetMultiple: 2 };

  it('ends the game when the best net worth reaches multiple x starting funds', () => {
    const { state, events } = rollOne(endOfDay({ config, cash: { p1: 20_000, p2: 5 } }));
    expect(gameEnded(events)).toEqual({
      type: 'GameEnded',
      reason: 'dayLimitOrNetWorthTarget',
      winners: ['p1'],
      netWorth: { p1: 20_000, p2: 5 },
    });
    expect(state.turn.phase).toEqual({ kind: 'gameOver', winners: ['p1'] });
  });

  it('does not end one short of the target', () => {
    const { events } = rollOne(endOfDay({ config, cash: { p1: 19_999, p2: 5 } }));
    expect(endedBy(events)).toBeUndefined();
  });

  it('counts cash, deposit and property', () => {
    let start = endOfDay({ config, cash: { p1: 15_000, p2: 5 }, board: BOARD });
    start = patchPlayer(start, 'p1', { deposit: 4000 });
    start = patchTile(start, 1, { owner: 'p1', level: 0 });
    // 15,000 + 4000 + 1001 = 20,001.
    const { events } = lastSeatRollsThree(start);
    expect(gameEnded(events)).toMatchObject({
      reason: 'dayLimitOrNetWorthTarget',
      winners: ['p1'],
    });
  });

  it('is only checked as a day goes by, not mid-round', () => {
    let start = newTestGame({ board: BLANK_BOARD, playerCount: 3, config });
    start = withCash(start, { p1: 1e6 });
    const afterP1 = rollOne(start);
    expect(endedBy(afterP1.events)).toBeUndefined();
    const afterP2 = rollOne(afterP1.state);
    expect(endedBy(afterP2.events)).toBeUndefined();
    expect(gameEnded(rollOne(afterP2.state).events)).toMatchObject({
      reason: 'dayLimitOrNetWorthTarget',
      winners: ['p1'],
    });
  });

  it('ends the game before a day limit is reached', () => {
    const both = { ...config, dayLimit: 99 };
    const { events } = rollOne(endOfDay({ config: both, cash: { p1: 20_000, p2: 5 } }));
    expect(gameEnded(events).reason).toBe('dayLimitOrNetWorthTarget');
  });

  it('cannot tell which condition ended the game when both hold the same day', () => {
    const cash = { p1: 20_000, p2: 5 };
    const ended = (limits: Partial<RuleConfig>) =>
      gameEnded(rollOne(endOfDay({ config: limits, cash })).events);
    const both = ended({ ...config, dayLimit: 1 });
    expect(both).toEqual(ended(config));
    expect(both).toEqual(ended({ dayLimit: 1 }));
  });
});

describe('viewFor', () => {
  it('sends the day limit and the net worth target', () => {
    const state = newTestGame({ config: { dayLimit: 30, netWorthTargetMultiple: 4 } });
    expect(viewFor(state, { kind: 'spectator' }).config).toMatchObject({
      dayLimit: 30,
      netWorthTargetMultiple: 4,
    });
  });
});

describe('after the game is over', () => {
  it('rejects every action and offers none', () => {
    let state = newTestGame({ board: BLANK_BOARD, config: { dayLimit: 1 } });
    state = rollOne(rollOne(state).state).state;
    expect(state.turn.phase.kind).toBe('gameOver');
    for (const type of ['rollDice', 'buyProperty', 'upgradeProperty', 'decline'] as const) {
      for (const playerId of ['p1', 'p2']) {
        expect(applyAction(state, { type, playerId })).toEqual({
          ok: false,
          error: { code: 'gameOver' },
        });
      }
    }
    expect(legalActions(state, 'p1')).toEqual([]);
    expect(legalActions(state, 'p2')).toEqual([]);
    expect(getPlayer(state, 'p1').bankrupt).toBe(false);
  });
});
