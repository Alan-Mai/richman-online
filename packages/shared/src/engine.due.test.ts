import { describe, expect, it } from 'vitest';
import { addDays, type CalendarDate } from './calendar';
import type { GameEvent } from './events';
import { checkInvariants } from './invariants';
import type { Controller, GameState } from './state';
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

/** Blank tiles only, plus four properties for the bankruptcy auction case. */
const BOARD = loopBoard([null, null, 100, 200, 300, 400, null, null]);

/** The day p1's turn starts on: the last seat's roll wraps the round, and a day goes by. */
const TODAY: CalendarDate = { year: 2010, month: 1, day: 2 };

/**
 * The last seat rolls onto a blank tile, ending the round; p1's turn then starts on TODAY with
 * the loan patched in, due `daysLeft` days on.
 */
function startP1(
  patch: { cash?: number; deposit?: number; loan: number },
  daysLeft: number,
  options: { controllers?: Controller[]; playerCount?: number } = {},
): { state: GameState; events: GameEvent[] } {
  const playerCount = options.playerCount ?? 2;
  const last = `p${playerCount}`;
  let state = newTestGame({ board: BOARD, playerCount, controllers: options.controllers });
  state = patchPlayer(state, 'p1', { ...patch, loanDue: addDays(TODAY, daysLeft) });
  state = withFixedDice(patchTurn(state, { current: last }), [1]);
  const result = applyOk(state, { type: 'rollDice', playerId: last });
  expect(result.state.date).toEqual(TODAY);
  return result;
}

/** The events from p1's TurnStarted on. */
function p1Start(events: GameEvent[]): GameEvent[] {
  const at = events.findIndex((e) => e.type === 'TurnStarted' && e.playerId === 'p1');
  expect(at).toBeGreaterThanOrEqual(0);
  return events.slice(at);
}

describe('a loan coming due at the start of the borrower’s turn', () => {
  it('says nothing more than 3 days ahead', () => {
    const { events } = startP1({ loan: 500 }, 4);
    expect(p1Start(events)).toEqual([{ type: 'TurnStarted', playerId: 'p1', round: 2 }]);
  });

  it('reminds a human 3 days ahead, but not a computer', () => {
    expect(p1Start(startP1({ loan: 500 }, 3).events)).toEqual([
      { type: 'TurnStarted', playerId: 'p1', round: 2 },
      { type: 'LoanReminder', playerId: 'p1', daysLeft: 3 },
    ]);
    const computer = startP1({ loan: 500 }, 3, { controllers: ['computer', 'human'] });
    expect(p1Start(computer.events)).toEqual([{ type: 'TurnStarted', playerId: 'p1', round: 2 }]);
  });

  it('reminds anyone 2 and 1 days ahead', () => {
    for (const controllers of [
      ['human', 'human'],
      ['computer', 'human'],
    ] as Controller[][]) {
      for (const daysLeft of [2, 1]) {
        const { events } = startP1({ loan: 500 }, daysLeft, { controllers });
        expect(p1Start(events)).toContainEqual({ type: 'LoanReminder', playerId: 'p1', daysLeft });
      }
    }
  });

  it('calls the whole loan in on the day, deposit first, and the turn goes on', () => {
    const { state, events } = startP1({ cash: 300, deposit: 200, loan: 450 }, 0);
    expect(p1Start(events)).toEqual([
      { type: 'TurnStarted', playerId: 'p1', round: 2 },
      { type: 'LoanCalledIn', playerId: 'p1', amount: 450 },
    ]);
    expect(getPlayer(state, 'p1')).toMatchObject({
      cash: 50,
      deposit: 0,
      loan: 0,
      loanDue: null,
      bankrupt: false,
    });
    expect(state.turn).toMatchObject({ current: 'p1', phase: { kind: 'awaitRoll' } });
    expect(checkInvariants(state)).toEqual([]);
  });

  it('calls in nothing when a computer already repaid, but clears the due date', () => {
    const { state, events } = startP1({ cash: 300, deposit: 200, loan: 0 }, 0);
    expect(p1Start(events)).toContainEqual({ type: 'LoanCalledIn', playerId: 'p1', amount: 0 });
    expect(getPlayer(state, 'p1')).toMatchObject({ cash: 300, deposit: 200, loanDue: null });
  });

  it('bankrupts a borrower who cannot pay, and the turn passes on after the auctions', () => {
    let start = newTestGame({ board: BOARD, playerCount: 3 });
    for (const tile of [2, 3, 4, 5]) start = patchTile(start, tile, { owner: 'p1', level: 0 });
    start = patchPlayer(start, 'p1', {
      cash: 30,
      deposit: 20,
      loan: 900,
      loanDue: TODAY,
    });
    // p2 and p3 cannot bid (no cash), so every drawn property goes unsold.
    start = patchPlayer(patchPlayer(start, 'p2', { cash: 0 }), 'p3', { cash: 0 });
    start = withFixedDice(patchTurn(start, { current: 'p3' }), [1]);
    // Three properties to auction, drawn by the RNG after the roll.
    start = { ...start, rngState: { kind: 'scripted', values: [0, 0, 0, 0] } };
    const { state, events } = applyOk(start, { type: 'rollDice', playerId: 'p3' });
    const types = p1Start(events).map((e) => e.type);
    expect(types.slice(0, 3)).toEqual(['TurnStarted', 'LoanCalledIn', 'PlayerBankrupt']);
    expect(p1Start(events)[2]).toMatchObject({
      type: 'PlayerBankrupt',
      playerId: 'p1',
      creditor: null,
      cause: { kind: 'loan', amountDue: 900 },
    });
    expect(types).not.toContain('PlayerPlaced');
    expect(types.at(-1)).toBe('TurnStarted');
    expect(state.turn.current).toBe('p2');
    expect(getPlayer(state, 'p1')).toMatchObject({ bankrupt: true, loan: 0, loanDue: null });
    expect(state.lotteryPool).toBe(0);
    expect(checkInvariants(state)).toEqual([]);
  });

  it('ends the game when that leaves one player', () => {
    const { state, events } = startP1({ cash: 0, deposit: 0, loan: 900 }, 0);
    expect(p1Start(events).map((e) => e.type)).toEqual([
      'TurnStarted',
      'LoanCalledIn',
      'PlayerBankrupt',
      'GameEnded',
    ]);
    expect(state.turn.phase).toEqual({ kind: 'gameOver', winners: ['p2'] });
  });

  it('does nothing once the due date has passed', () => {
    const { state, events } = startP1({ cash: 0, deposit: 0, loan: 900 }, -1);
    expect(p1Start(events)).toEqual([{ type: 'TurnStarted', playerId: 'p1', round: 2 }]);
    expect(getPlayer(state, 'p1').loan).toBe(900);
  });
});
