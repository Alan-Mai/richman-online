import { describe, expect, it } from 'vitest';
import type { Action } from './actions';
import { applyAction, legalActions } from './engine';
import type { GameState } from './state';
import {
  applyOk,
  getPlayer,
  loopBoard,
  newTestGame,
  patchPlayer,
  patchTurn,
  withFixedDice,
} from './testing';

/** 20 blank tiles, so landing never stops for a decision. */
const BLANK_LOOP = loopBoard(Array.from({ length: 20 }, () => null));

function game(options: Parameters<typeof newTestGame>[0] = {}): GameState {
  return newTestGame({ board: BLANK_LOOP, ...options });
}

const roll = (playerId: string): Action => ({ type: 'rollDice', playerId });

describe('rollDice', () => {
  it('moves the player by the die and passes the turn', () => {
    const { state, events } = applyOk(withFixedDice(game(), [3]), roll('p1'));
    expect(getPlayer(state, 'p1').position).toBe(3);
    expect(events).toEqual([
      { type: 'DiceRolled', playerId: 'p1', dice: [3], total: 3 },
      { type: 'PlayerMoved', playerId: 'p1', path: [1, 2, 3] },
      { type: 'TurnStarted', playerId: 'p2', round: 1 },
    ]);
    expect(state.turn).toEqual({ current: 'p2', round: 1, phase: { kind: 'awaitRoll' } });
  });

  it('rolls diceCount dice and moves by their total', () => {
    const start = withFixedDice(patchPlayer(game(), 'p1', { diceCount: 3 }), [1, 2, 6]);
    const { state, events } = applyOk(start, roll('p1'));
    expect(events[0]).toEqual({ type: 'DiceRolled', playerId: 'p1', dice: [1, 2, 6], total: 9 });
    expect(getPlayer(state, 'p1').position).toBe(9);
    expect(state.rngState).toEqual({ kind: 'scripted', values: [] });
  });

  it('advances the mulberry32 state and is deterministic', () => {
    const first = applyOk(game(), roll('p1'));
    expect(first.state.rngState).not.toEqual(game().rngState);
    expect(applyOk(game(), roll('p1'))).toEqual(first);

    // Different RNG states give a different sequence of rolls over a few turns.
    const totals = (seed: number) => {
      let state = game({ seed });
      const out: number[] = [];
      for (let i = 0; i < 8; i++) {
        const step = applyOk(state, roll(state.turn.current));
        const dice = step.events[0];
        out.push(dice?.type === 'DiceRolled' ? dice.total : -1);
        state = step.state;
      }
      return out;
    };
    expect(totals(1)).toEqual(totals(1));
    expect(totals(1)).not.toEqual(totals(2));
    for (const total of totals(3)) expect(total).toBeGreaterThanOrEqual(1);
  });

  it('wraps around the loop', () => {
    const start = withFixedDice(patchPlayer(game(), 'p1', { position: 18 }), [4]);
    const { state, events } = applyOk(start, roll('p1'));
    expect(events[1]).toEqual({ type: 'PlayerMoved', playerId: 'p1', path: [19, 0, 1, 2] });
    expect(getPlayer(state, 'p1').position).toBe(2);
  });

  it('walks against next when facing backward', () => {
    const start = withFixedDice(
      patchPlayer(game(), 'p1', { position: 1, direction: 'backward' }),
      [3],
    );
    const { state, events } = applyOk(start, roll('p1'));
    expect(events[1]).toEqual({ type: 'PlayerMoved', playerId: 'p1', path: [0, 19, 18] });
    expect(getPlayer(state, 'p1').position).toBe(18);
  });

  it('does not change the input state', () => {
    const start = withFixedDice(game(), [5]);
    const snapshot = JSON.stringify(start);
    applyOk(start, roll('p1'));
    expect(JSON.stringify(start)).toBe(snapshot);
  });
});

describe('pass triggers', () => {
  it('gives nothing for passing start when passStartBonus is 0', () => {
    const start = withFixedDice(patchPlayer(game(), 'p1', { position: 18 }), [4]);
    const { state, events } = applyOk(start, roll('p1'));
    expect(events.map((e) => e.type)).toEqual(['DiceRolled', 'PlayerMoved', 'TurnStarted']);
    expect(getPlayer(state, 'p1').cash).toBe(getPlayer(start, 'p1').cash);
  });

  it('splits the move at the start tile and pays passStartBonus', () => {
    const base = game({ config: { passStartBonus: 500 } });
    const start = withFixedDice(patchPlayer(base, 'p1', { position: 18 }), [4]);
    const { state, events } = applyOk(start, roll('p1'));
    expect(events).toEqual([
      { type: 'DiceRolled', playerId: 'p1', dice: [4], total: 4 },
      { type: 'PlayerMoved', playerId: 'p1', path: [19, 0] },
      { type: 'PassBonusReceived', playerId: 'p1', tile: 0, amount: 500 },
      { type: 'PlayerMoved', playerId: 'p1', path: [1, 2] },
      { type: 'TurnStarted', playerId: 'p2', round: 1 },
    ]);
    expect(getPlayer(state, 'p1').cash).toBe(getPlayer(start, 'p1').cash + 500);
  });

  it('gives no bonus for landing exactly on start', () => {
    const base = game({ config: { passStartBonus: 500 } });
    const start = withFixedDice(patchPlayer(base, 'p1', { position: 17 }), [3]);
    const { state, events } = applyOk(start, roll('p1'));
    expect(events.map((e) => e.type)).toEqual(['DiceRolled', 'PlayerMoved', 'TurnStarted']);
    expect(getPlayer(state, 'p1').position).toBe(0);
    expect(getPlayer(state, 'p1').cash).toBe(getPlayer(start, 'p1').cash);
  });

  it('gives no bonus for leaving start', () => {
    const base = game({ config: { passStartBonus: 500 } });
    const { events } = applyOk(withFixedDice(base, [6]), roll('p1'));
    expect(events.map((e) => e.type)).not.toContain('PassBonusReceived');
  });

  it('pays once per pass when one roll laps the board', () => {
    const board = loopBoard([null, null, null, null]);
    const base = newTestGame({ board, config: { passStartBonus: 100 } });
    // From 0, 9 steps: 1 2 3 [0] 1 2 3 [0] 1.
    const start = withFixedDice(patchPlayer(base, 'p1', { diceCount: 3 }), [3, 3, 3]);
    const { state, events } = applyOk(start, roll('p1'));
    expect(events.slice(1, -1)).toEqual([
      { type: 'PlayerMoved', playerId: 'p1', path: [1, 2, 3, 0] },
      { type: 'PassBonusReceived', playerId: 'p1', tile: 0, amount: 100 },
      { type: 'PlayerMoved', playerId: 'p1', path: [1, 2, 3, 0] },
      { type: 'PassBonusReceived', playerId: 'p1', tile: 0, amount: 100 },
      { type: 'PlayerMoved', playerId: 'p1', path: [1] },
    ]);
    expect(getPlayer(state, 'p1').cash).toBe(getPlayer(start, 'p1').cash + 200);
  });

  it('triggers on the start tile when walking backward too', () => {
    const base = game({ config: { passStartBonus: 50 } });
    const start = withFixedDice(
      patchPlayer(base, 'p1', { position: 2, direction: 'backward' }),
      [4],
    );
    const { events } = applyOk(start, roll('p1'));
    expect(events.slice(1, 4)).toEqual([
      { type: 'PlayerMoved', playerId: 'p1', path: [1, 0] },
      { type: 'PassBonusReceived', playerId: 'p1', tile: 0, amount: 50 },
      { type: 'PlayerMoved', playerId: 'p1', path: [19, 18] },
    ]);
  });
});

describe('turn order', () => {
  it('cycles through seats and counts rounds', () => {
    let state = game({ playerCount: 3 });
    const seen: string[] = [];
    for (let i = 0; i < 7; i++) {
      const step = applyOk(withFixedDice(state, [1]), roll(state.turn.current));
      const started = step.events.at(-1);
      if (started?.type !== 'TurnStarted') throw new Error('expected TurnStarted');
      seen.push(`${started.playerId}@${started.round}`);
      state = step.state;
    }
    expect(seen).toEqual(['p2@1', 'p3@1', 'p1@2', 'p2@2', 'p3@2', 'p1@3', 'p2@3']);
    expect(state.turn.round).toBe(3);
  });

  it('skips bankrupt players', () => {
    const start = withFixedDice(
      patchPlayer(game({ playerCount: 3 }), 'p2', { bankrupt: true }),
      [1],
    );
    const { state } = applyOk(start, roll('p1'));
    expect(state.turn.current).toBe('p3');
    expect(state.turn.round).toBe(1);
  });

  it('starts a new round when the last seat is bankrupt', () => {
    let state = patchPlayer(game({ playerCount: 3 }), 'p3', { bankrupt: true });
    state = applyOk(withFixedDice(state, [1]), roll('p1')).state;
    const { state: after, events } = applyOk(withFixedDice(state, [1]), roll('p2'));
    expect(after.turn).toMatchObject({ current: 'p1', round: 2 });
    expect(events.at(-1)).toEqual({ type: 'TurnStarted', playerId: 'p1', round: 2 });
  });
});

describe('applyAction validation', () => {
  const malformed: [string, unknown][] = [
    ['null', null],
    ['undefined', undefined],
    ['a number', 7],
    ['a string', 'rollDice'],
    ['an array', ['rollDice', 'p1']],
    ['an empty object', {}],
    ['an unknown type', { type: 'teleport', playerId: 'p1' }],
    ['a non-string type', { type: 1, playerId: 'p1' }],
    ['a missing playerId', { type: 'rollDice' }],
    ['a numeric playerId', { type: 'rollDice', playerId: 1 }],
    ['a null playerId', { type: 'rollDice', playerId: null }],
  ];

  it.each(malformed)('rejects %s as invalidAction without throwing', (_, raw) => {
    const state = game();
    const snapshot = JSON.stringify(state);
    expect(applyAction(state, raw as Action)).toEqual({
      ok: false,
      error: { code: 'invalidAction' },
    });
    expect(JSON.stringify(state)).toBe(snapshot);
  });

  it('ignores extra fields on a well-formed action', () => {
    const raw = { type: 'rollDice', playerId: 'p1', dice: [6, 6], cash: 1e9 } as Action;
    const { state, events } = applyOk(withFixedDice(game(), [2]), raw);
    expect(getPlayer(state, 'p1')).toMatchObject({
      position: 2,
      cash: getPlayer(game(), 'p1').cash,
    });
    expect(events[0]).toEqual({ type: 'DiceRolled', playerId: 'p1', dice: [2], total: 2 });
  });

  it('checks the format before anything else', () => {
    const over = patchTurn(game(), { phase: { kind: 'gameOver', winners: ['p1'] } });
    expect(applyAction(over, { type: 'rollDice' } as Action)).toEqual({
      ok: false,
      error: { code: 'invalidAction' },
    });
  });

  it('rejects every action once the game is over', () => {
    const over = patchTurn(game(), { phase: { kind: 'gameOver', winners: ['p1'] } });
    expect(applyAction(over, roll('p1'))).toEqual({ ok: false, error: { code: 'gameOver' } });
    expect(applyAction(over, roll('nobody'))).toEqual({ ok: false, error: { code: 'gameOver' } });
  });

  it('rejects unknown players', () => {
    expect(applyAction(game(), roll('nobody'))).toEqual({
      ok: false,
      error: { code: 'unknownPlayer' },
    });
  });

  it('rejects players whose turn it is not', () => {
    const state = game();
    const snapshot = JSON.stringify(state);
    expect(applyAction(state, roll('p2'))).toEqual({ ok: false, error: { code: 'notYourTurn' } });
    expect(JSON.stringify(state)).toBe(snapshot);
  });

  it('rejects rolling while a decision is pending', () => {
    const state = patchTurn(game(), { phase: { kind: 'awaitBuyDecision', tile: 3, price: 10 } });
    expect(applyAction(state, roll('p1'))).toEqual({
      ok: false,
      error: { code: 'wrongPhase', phase: 'awaitBuyDecision' },
    });
  });

  it('rejects decisions while waiting for a roll', () => {
    for (const type of ['buyProperty', 'upgradeProperty', 'decline'] as const) {
      expect(applyAction(game(), { type, playerId: 'p1' })).toEqual({
        ok: false,
        error: { code: 'wrongPhase', phase: 'awaitRoll' },
      });
    }
  });
});

describe('legalActions for awaitRoll', () => {
  it('offers rollDice to the current player only', () => {
    const state = game({ playerCount: 3 });
    expect(legalActions(state, 'p1')).toEqual([{ type: 'rollDice', playerId: 'p1' }]);
    expect(legalActions(state, 'p2')).toEqual([]);
    expect(legalActions(state, 'nobody')).toEqual([]);
  });

  it('offers nothing once the game is over', () => {
    const over = patchTurn(game(), { phase: { kind: 'gameOver', winners: ['p1'] } });
    expect(legalActions(over, 'p1')).toEqual([]);
  });
});
