import { describe, expect, it } from 'vitest';
import type { Action } from './actions';
import type { Vehicle } from './config';
import { applyAction, legalActions } from './engine';
import type { GameState } from './state';
import {
  applyOk,
  getPlayer,
  loopBoard,
  newTestGame,
  patchTurn,
  scriptedRng,
  tileOf,
} from './testing';

/** 20 blank tiles, so landing never stops for a decision. */
const BLANK_LOOP = loopBoard(Array.from({ length: 20 }, () => null));

function game(startingVehicle: Vehicle): GameState {
  return newTestGame({ board: BLANK_LOOP, config: { startingVehicle } });
}

const setDice = (playerId: string, count: number): Action => ({
  type: 'setDiceCount',
  playerId,
  count,
});
const roll = (playerId: string): Action => ({ type: 'rollDice', playerId });

describe('setDiceCount', () => {
  it('is offered for every count up to the vehicle limit on a motorbike or car', () => {
    expect(legalActions(game('motorbike'), 'p1')).toEqual([
      roll('p1'),
      setDice('p1', 1),
      setDice('p1', 2),
    ]);
    expect(legalActions(game('car'), 'p1')).toEqual([
      roll('p1'),
      setDice('p1', 1),
      setDice('p1', 2),
      setDice('p1', 3),
    ]);
  });

  it('is not offered on foot, and refused there', () => {
    const state = game('walk');
    expect(legalActions(state, 'p1')).toEqual([roll('p1')]);
    expect(applyAction(state, setDice('p1', 1))).toEqual({
      ok: false,
      error: { code: 'invalidAction' },
    });
  });

  it('sets the count without rolling or ending the turn', () => {
    const start = game('car');
    const { state, events } = applyOk(start, setDice('p1', 1));
    expect(events).toEqual([{ type: 'DiceCountSet', playerId: 'p1', count: 1 }]);
    expect(getPlayer(state, 'p1').diceCount).toBe(1);
    expect(state.turn).toEqual(start.turn);
    expect(state.rngState).toEqual(start.rngState);
    // Choosing again before rolling is fine, including the count already set.
    expect(getPlayer(applyOk(state, setDice('p1', 2)).state, 'p1').diceCount).toBe(2);
    expect(getPlayer(applyOk(state, setDice('p1', 1)).state, 'p1').diceCount).toBe(1);
  });

  it('rolls the chosen number of dice', () => {
    const chosen = applyOk(game('car'), setDice('p1', 2)).state;
    expect(getPlayer(chosen, 'p1').diceCount).toBe(2);
    const { state, events } = applyOk({ ...chosen, rngState: scriptedRng([3, 4]) }, roll('p1'));
    expect(events[0]).toEqual({ type: 'DiceRolled', playerId: 'p1', dice: [4, 5], total: 9 });
    expect(tileOf(state, 'p1')).toBe(9);
  });

  it('refuses counts outside 1 to the vehicle limit', () => {
    for (const [vehicle, count] of [
      ['motorbike', 0],
      ['motorbike', 3],
      ['car', 4],
      ['car', -1],
      ['car', 1.5],
    ] as const) {
      expect(applyAction(game(vehicle), setDice('p1', count))).toEqual({
        ok: false,
        error: { code: 'invalidAction' },
      });
    }
  });

  it('refuses the wrong player and the wrong phase', () => {
    const state = game('car');
    expect(applyAction(state, setDice('p2', 1))).toEqual({
      ok: false,
      error: { code: 'notYourTurn' },
    });
    const buying = patchTurn(state, { phase: { kind: 'awaitBuyDecision', tile: 0, price: 1 } });
    expect(applyAction(buying, setDice('p1', 1))).toEqual({
      ok: false,
      error: { code: 'wrongPhase', phase: 'awaitBuyDecision' },
    });
    expect(legalActions(buying, 'p1').some((a) => a.type === 'setDiceCount')).toBe(false);
  });

  it('keeps the count for later turns', () => {
    let state = applyOk(game('car'), setDice('p1', 1)).state;
    expect(getPlayer(state, 'p1').diceCount).toBe(1);
    state = applyOk({ ...state, rngState: scriptedRng([0]) }, roll('p1')).state;
    expect(getPlayer(state, 'p2').diceCount).toBe(3);
    state = applyOk({ ...state, rngState: scriptedRng([0, 0, 0]) }, roll('p2')).state;
    expect(state.turn.current).toBe('p1');
    expect(getPlayer(state, 'p1').diceCount).toBe(1);
    const { events } = applyOk({ ...state, rngState: scriptedRng([5]) }, roll('p1'));
    expect(events[0]).toEqual({ type: 'DiceRolled', playerId: 'p1', dice: [6], total: 6 });
  });
});
