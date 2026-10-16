import { describe, expect, it } from 'vitest';
import type { GameEvent } from './events';
import { checkInvariants } from './invariants';
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

const BLANK_BOARD = loopBoard([null, null, null, null, null, null]);
const DUE = { year: 2010, month: 3, day: 1 };

/** Three players on 31 January; p3 (the last seat) is about to end the round. */
function lastDayOfJanuary(config: Partial<GameState['config']> = {}): GameState {
  const start = newTestGame({ board: BLANK_BOARD, playerCount: 3, config });
  const state = { ...start, date: { year: 2010, month: 1, day: 31 }, day: 30 };
  return patchTurn(state, { current: 'p3' });
}

/** p3 rolls a 1 onto a blank tile, ending the round: a day goes by. */
function endRound(state: GameState): { state: GameState; events: GameEvent[] } {
  return applyOk(withFixedDice(state, [1]), { type: 'rollDice', playerId: 'p3' });
}

describe('the first day of a month', () => {
  it('pays 10% on the deposit, rounded down, to players in the game without a loan', () => {
    let state = lastDayOfJanuary();
    state = patchPlayer(state, 'p1', { deposit: 12_345 });
    state = patchPlayer(state, 'p2', { deposit: 9000, loan: 500, loanDue: DUE });
    state = patchPlayer(state, 'p3', { deposit: 7 });
    const { state: next, events } = endRound(state);
    const day = events.findIndex((e) => e.type === 'DayAdvanced');
    expect(events[day + 1]).toEqual({
      type: 'MonthStarted',
      players: [
        { playerId: 'p1', kind: 'interest', amount: 1234 },
        { playerId: 'p2', kind: 'onLoan' },
        { playerId: 'p3', kind: 'interest', amount: 0 },
      ],
    });
    expect(next.date).toEqual({ year: 2010, month: 2, day: 1 });
    expect(getPlayer(next, 'p1').deposit).toBe(13_579);
    expect(getPlayer(next, 'p2').deposit).toBe(9000);
    expect(getPlayer(next, 'p3').deposit).toBe(7);
    expect(checkInvariants(next)).toEqual([]);
  });

  it('pays a computer that repaid early, whose due date is kept', () => {
    const state = patchPlayer(lastDayOfJanuary(), 'p1', { deposit: 1000, loan: 0, loanDue: DUE });
    const { state: next } = endRound(state);
    expect(getPlayer(next, 'p1').deposit).toBe(1100);
  });

  it('leaves bankrupt players out', () => {
    const state = patchPlayer(lastDayOfJanuary(), 'p2', { cash: 0, deposit: 0, bankrupt: true });
    const { events } = endRound(state);
    const report = events.find((e) => e.type === 'MonthStarted');
    expect(report).toMatchObject({ players: [{ playerId: 'p1' }, { playerId: 'p3' }] });
  });

  it('comes after the price index, which sees the deposits before interest', () => {
    // Starting funds 10,000: an average net worth of 19,999 keeps the index at 1, and the
    // 10% that follows does not count until the next day.
    let state = lastDayOfJanuary({ startingFunds: 10_000 });
    for (const id of ['p1', 'p2', 'p3'])
      state = patchPlayer(state, id, { cash: 0, deposit: 19_999 });
    const { state: next, events } = endRound(state);
    expect(next.priceIndex).toBe(1);
    expect(events.map((e) => e.type)).toEqual([
      'DiceRolled',
      'PlayerMoved',
      'DayAdvanced',
      'MonthStarted',
      'TurnStarted',
    ]);
    expect(getPlayer(next, 'p1').deposit).toBe(21_998);
  });

  it('does nothing on other days', () => {
    const state = { ...lastDayOfJanuary(), date: { year: 2010, month: 1, day: 30 }, day: 29 };
    const { state: next, events } = endRound(state);
    expect(events.map((e) => e.type)).not.toContain('MonthStarted');
    expect(getPlayer(next, 'p1').deposit).toBe(getPlayer(state, 'p1').deposit);
  });

  it('does nothing when the game ends that day', () => {
    const { state: next, events } = endRound(lastDayOfJanuary({ dayLimit: 31 }));
    expect(next.turn.phase.kind).toBe('gameOver');
    expect(events.map((e) => e.type)).not.toContain('MonthStarted');
  });
});
