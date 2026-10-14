import { describe, expect, it } from 'vitest';
import type { Action } from './actions';
import type { RuleConfig } from './config';
import { applyAction, legalActions } from './engine';
import type { GameEvent } from './events';
import { totalAssets } from './money';
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

const PRICE = 1001;
/** Tile 1 and 2 are properties; the rest are blank. */
const BOARD = loopBoard([null, PRICE, 2000, null, null, null]);
const BLANK_BOARD = loopBoard([null, null, null, null, null, null]);

const roundLimit = (maxRounds: number): Partial<RuleConfig> => ({
  winCondition: 'richestAtRoundLimit',
  maxRounds,
});

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

function gameEnded(events: GameEvent[]) {
  const last = events.at(-1);
  if (last?.type !== 'GameEnded') throw new Error(`expected GameEnded, got ${last?.type}`);
  return last;
}

describe('totalAssets', () => {
  it('adds cash, deposit and what was invested in own properties', () => {
    let state = newTestGame({ board: BOARD });
    state = patchPlayer(state, 'p1', { cash: 10, deposit: 20 });
    state = patchTile(state, 1, { owner: 'p1', level: 2 });
    state = patchTile(state, 2, { owner: 'p2', level: 5 });
    // 10 + 20 + 1001 + 2 * 500 (testProperty's upgrade cost)
    expect(totalAssets(state, 'p1')).toBe(2031);
  });

  it("uses each tile's own upgrade cost", () => {
    const amounts = { price: 900, upgradeCost: 123, rents: [1, 2, 3, 4, 5, 6] };
    const board = loopBoard([null, amounts, null, null]);
    let state = patchPlayer(newTestGame({ board }), 'p1', { cash: 1, deposit: 2 });
    state = patchTile(state, 1, { owner: 'p1', level: 3 });
    expect(totalAssets(state, 'p1')).toBe(1 + 2 + 900 + 3 * 123);
  });

  it('counts only the price for an unbuilt property', () => {
    let state = withCash(newTestGame({ board: BOARD }), { p1: 0 });
    state = patchTile(state, 2, { owner: 'p1', level: 0 });
    expect(totalAssets(state, 'p1')).toBe(2000);
  });

  it('does not change when buying or upgrading', () => {
    let state = withCash(newTestGame({ board: BOARD }), { p1: 5000 });
    const before = totalAssets(state, 'p1');
    state = applyOk(rollOne(state).state, { type: 'buyProperty', playerId: 'p1' }).state;
    expect(totalAssets(state, 'p1')).toBe(before);

    // p2 rolls a 3 to a blank tile, then p1 goes round to tile 1 again (6 steps) and upgrades.
    state = applyOk(withFixedDice(state, [3]), roll('p2')).state;
    state = applyOk(withFixedDice(state, [6]), roll('p1')).state;
    expect(state.turn.phase.kind).toBe('awaitUpgradeDecision');
    state = applyOk(state, { type: 'upgradeProperty', playerId: 'p1' }).state;
    expect(state.tiles[1]).toEqual({ owner: 'p1', level: 1 });
    expect(totalAssets(state, 'p1')).toBe(before);
  });
});

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
    expect(gameEnded(events)).toEqual({
      type: 'GameEnded',
      reason: 'lastStanding',
      winners: ['p2'],
      totalAssets: { p1: 0, p2: 51 + PRICE },
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

  it('also ends a richestAtRoundLimit game early', () => {
    const { events } = rollOne(fatalLanding({ config: roundLimit(50) }));
    expect(gameEnded(events)).toMatchObject({ reason: 'lastStanding', winners: ['p2'] });
  });

  it('takes priority over the round limit on the last turn', () => {
    let start = newTestGame({ board: BOARD, config: roundLimit(4) });
    start = patchTile(start, 1, { owner: 'p1', level: 0 });
    start = patchTurn(withCash(start, { p1: 0, p2: 1 }), { current: 'p2', round: 4 });
    const { events } = rollOne(start);
    expect(gameEnded(events)).toMatchObject({ reason: 'lastStanding', winners: ['p1'] });
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
        totalAssets: {
          p1: totalAssets(state, 'p1'),
          p2: totalAssets(state, 'p2'),
          p3: totalAssets(state, 'p3'),
        },
      },
    ]);
    expect(after.turn.phase).toEqual({ kind: 'gameOver', winners: [] });
  });

  it('never ends by round count when maxRounds is null', () => {
    let state = newTestGame({ board: BLANK_BOARD });
    for (let i = 0; i < 40; i++) state = rollOne(state).state;
    expect(state.turn).toMatchObject({ round: 21, phase: { kind: 'awaitRoll' } });
  });
});

describe('richestAtRoundLimit', () => {
  it('ends after the last seat finishes round maxRounds', () => {
    let state = newTestGame({ board: BLANK_BOARD, playerCount: 3, config: roundLimit(1) });
    state = rollOne(state).state;
    state = rollOne(state).state;
    expect(state.turn).toMatchObject({ current: 'p3', phase: { kind: 'awaitRoll' } });
    const { state: after, events } = rollOne(state);
    expect(gameEnded(events).reason).toBe('roundLimit');
    expect(events.map((e) => e.type)).not.toContain('TurnStarted');
    expect(after.turn).toMatchObject({ round: 1, phase: { kind: 'gameOver' } });
  });

  it('does not end before round maxRounds', () => {
    let state = newTestGame({ board: BLANK_BOARD, config: roundLimit(3) });
    for (let i = 0; i < 5; i++) {
      state = rollOne(state).state;
      expect(state.turn.phase.kind).toBe('awaitRoll');
    }
    expect(state.turn).toMatchObject({ current: 'p2', round: 3 });
    expect(gameEnded(rollOne(state).events).reason).toBe('roundLimit');
  });

  it('ends after the last player still in the game when the last seat is bankrupt', () => {
    let state = newTestGame({ board: BLANK_BOARD, playerCount: 3, config: roundLimit(1) });
    state = patchPlayer(state, 'p3', { bankrupt: true, cash: 0, deposit: 0 });
    state = rollOne(state).state;
    const { events } = rollOne(state);
    expect(gameEnded(events)).toMatchObject({ reason: 'roundLimit', winners: ['p1', 'p2'] });
  });

  it('ends only once the pending decision is made', () => {
    let state = newTestGame({ board: BOARD, config: roundLimit(1) });
    state = patchTurn(withCash(state, { p2: 5000 }), { current: 'p2' });
    state = rollOne(state).state;
    expect(state.turn.phase.kind).toBe('awaitBuyDecision');
    const { events } = applyOk(state, { type: 'decline', playerId: 'p2' });
    expect(gameEnded(events).reason).toBe('roundLimit');
  });

  it('excludes a player who goes bankrupt on the last turn', () => {
    let state = newTestGame({ board: BOARD, playerCount: 3, config: roundLimit(2) });
    state = patchTile(state, 1, { owner: 'p1', level: 0 });
    state = withCash(state, { p1: 10, p2: 20, p3: 0 });
    state = patchTurn(state, { current: 'p3', round: 2 });
    const { events } = rollOne(state);
    expect(events.slice(2).map((e) => e.type)).toEqual(['PlayerBankrupt', 'GameEnded']);
    // p1 owns tile 1 and collected nothing (p3 had nothing under 'remaining').
    expect(gameEnded(events)).toEqual({
      type: 'GameEnded',
      reason: 'roundLimit',
      winners: ['p1'],
      totalAssets: { p1: 10 + PRICE, p2: 20, p3: 0 },
    });
  });

  describe('ties', () => {
    function finalTurn(cash: Record<string, number>, playerCount: number) {
      let state = newTestGame({ board: BLANK_BOARD, playerCount, config: roundLimit(1) });
      state = withCash(state, cash);
      return patchTurn(state, { current: `p${playerCount}` });
    }

    it('names the single richest player', () => {
      const { events } = rollOne(finalTurn({ p1: 5, p2: 6, p3: 4 }, 3));
      expect(gameEnded(events).winners).toEqual(['p2']);
    });

    it('lists two tied players in seat order', () => {
      const { state, events } = rollOne(finalTurn({ p1: 7, p2: 3, p3: 7 }, 3));
      expect(gameEnded(events).winners).toEqual(['p1', 'p3']);
      expect(state.turn.phase).toEqual({ kind: 'gameOver', winners: ['p1', 'p3'] });
    });

    it('lists three tied players', () => {
      const { events } = rollOne(finalTurn({ p1: 9, p2: 9, p3: 9 }, 3));
      expect(gameEnded(events).winners).toEqual(['p1', 'p2', 'p3']);
    });

    it('ties the last two standing and leaves out the bankrupt even at zero assets', () => {
      let state = finalTurn({ p1: 0, p2: 0, p3: 0 }, 3);
      state = patchPlayer(state, 'p2', { bankrupt: true });
      const { events } = rollOne(state);
      expect(gameEnded(events)).toEqual({
        type: 'GameEnded',
        reason: 'roundLimit',
        winners: ['p1', 'p3'],
        totalAssets: { p1: 0, p2: 0, p3: 0 },
      });
    });
  });
});

describe('after the game is over', () => {
  it('rejects every action and offers none', () => {
    let state = newTestGame({ board: BLANK_BOARD, config: roundLimit(1) });
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
