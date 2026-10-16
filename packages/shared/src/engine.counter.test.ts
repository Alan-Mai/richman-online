import { describe, expect, it } from 'vitest';
import type { Action } from './actions';
import type { Board } from './board';
import { applyAction, computerAction, legalActions } from './engine';
import type { HolidayRule } from './holidays';
import { checkInvariants } from './invariants';
import type { GameState, Phase } from './state';
import { viewFor } from './view';
import {
  applyOk,
  getPlayer,
  loopBoard,
  newTestGame,
  patchPlayer,
  patchTile,
  patchTurn,
  placePlayer,
  withFixedDice,
} from './testing';

/** 0 blank, 1 bank, 2 property (1000), 3 bank, 4 and 5 blank. */
const BOARD = loopBoard([null, 'bank', 1000, 'bank', null, null]);

const COUNTER: Phase = { kind: 'bankCounter', tile: 1 };
const DUE = { year: 2010, month: 4, day: 1 };

const leaveBank = (playerId = 'p1'): Action => ({ type: 'leaveBank', playerId });
const leave = (playerId = 'p1'): Action => ({ type: 'leaveCounter', playerId });
const borrow = (amount: number, playerId = 'p1'): Action => ({ type: 'borrow', playerId, amount });
const repay = (amount: number, playerId = 'p1'): Action => ({ type: 'repay', playerId, amount });

function game(board: Board = BOARD): GameState {
  return newTestGame({ board });
}

/** p1 lands on bank 1 (rolling 1 from tile 0) and leaves the bank screen: the counter opens. */
function atCounter(start: GameState = game()): GameState {
  const banked = applyOk(withFixedDice(start, [1]), { type: 'rollDice', playerId: 'p1' }).state;
  expect(banked.turn.phase.kind).toBe('bank');
  const { state } = applyOk(banked, leaveBank());
  expect(state.turn.phase).toEqual(COUNTER);
  return state;
}

/** atCounter with p1's money and loan set first. */
function counterWith(patch: Parameters<typeof patchPlayer>[2], start: GameState = game()) {
  return atCounter(patchPlayer(start, 'p1', patch));
}

describe('the bank counter', () => {
  it('opens after the bank screen when stopping on a bank, whatever was done there', () => {
    const banked = applyOk(withFixedDice(game(), [1]), { type: 'rollDice', playerId: 'p1' }).state;
    for (const action of [
      leaveBank(),
      { type: 'bankTransfer', playerId: 'p1', direction: 'deposit', amount: 100 } as const,
    ]) {
      const { state, events } = applyOk(banked, action);
      expect(events.at(-1)).toEqual({ type: 'CounterOpened', playerId: 'p1', tile: 1 });
      expect(state.turn).toMatchObject({ current: 'p1', phase: COUNTER });
      expect(checkInvariants(state)).toEqual([]);
    }
  });

  it('does not open when passing a bank', () => {
    // Rolling 2 passes bank 1 and stops on the property at 2.
    const start = withFixedDice(game(), [2]);
    const paused = applyOk(start, { type: 'rollDice', playerId: 'p1' }).state;
    expect(paused.turn.phase).toMatchObject({ kind: 'bank', trigger: { kind: 'pass' } });
    const { events } = applyOk(paused, leaveBank());
    expect(events.map((e) => e.type)).not.toContain('CounterOpened');
  });

  it('offers borrowing up to net worth minus the loan, and leaving', () => {
    // Net worth 40,000: half cash, half deposit.
    expect(legalActions(atCounter(), 'p1')).toEqual([
      { type: 'borrow', playerId: 'p1', max: 40_000 },
      { type: 'leaveCounter', playerId: 'p1' },
    ]);
    expect(legalActions(atCounter(), 'p2')).toEqual([]);
  });

  it('offers repaying up to the loan when cash and deposit cover it', () => {
    // Net worth 40,000 - 1000 = 39,000, so 38,000 more may be borrowed.
    const state = counterWith({ loan: 1000, loanDue: DUE });
    expect(legalActions(state, 'p1')).toEqual([
      { type: 'borrow', playerId: 'p1', max: 38_000 },
      { type: 'repay', playerId: 'p1', max: 1000 },
      { type: 'leaveCounter', playerId: 'p1' },
    ]);
  });

  it('caps repaying at cash plus deposit', () => {
    const state = counterWith({ cash: 100, deposit: 50, loan: 1000, loanDue: DUE });
    expect(legalActions(state, 'p1')).toContainEqual({ type: 'repay', playerId: 'p1', max: 150 });
  });

  it('offers no borrowing once the loan reaches net worth', () => {
    // Net worth 500 - 500 = 0 <= the loan.
    const state = counterWith({ cash: 0, deposit: 500, loan: 500, loanDue: DUE });
    expect(legalActions(state, 'p1')).toEqual([
      { type: 'repay', playerId: 'p1', max: 500 },
      { type: 'leaveCounter', playerId: 'p1' },
    ]);
  });

  it('offers no repaying with no cash and no deposit (a non-original adjustment)', () => {
    // Net worth 1000 (the property) - 300 = 700, so 400 more may be borrowed.
    const start = patchTile(game(), 2, { owner: 'p1', level: 0 });
    const state = counterWith({ cash: 0, deposit: 0, loan: 300, loanDue: DUE }, start);
    expect(legalActions(state, 'p1')).toEqual([
      { type: 'borrow', playerId: 'p1', max: 400 },
      { type: 'leaveCounter', playerId: 'p1' },
    ]);
  });

  it('ends the turn when the player leaves', () => {
    const { state, events } = applyOk(atCounter(), leave());
    expect(events).toEqual([{ type: 'TurnStarted', playerId: 'p2', round: 1 }]);
    expect(state.turn.current).toBe('p2');
  });
});

describe('borrowing', () => {
  it('puts the money in the deposit, sets the due date 90 days on, and ends the turn', () => {
    const { state, events } = applyOk(atCounter(), borrow(5000));
    expect(events).toEqual([
      {
        type: 'LoanBorrowed',
        playerId: 'p1',
        amount: 5000,
        loan: 5000,
        loanDue: DUE,
        by: 'counter',
      },
      { type: 'TurnStarted', playerId: 'p2', round: 1 },
    ]);
    expect(getPlayer(state, 'p1')).toMatchObject({
      cash: 20_000,
      deposit: 25_000,
      loan: 5000,
      loanDue: DUE,
    });
    expect(checkInvariants(state)).toEqual([]);
  });

  it('keeps the due date of an earlier loan', () => {
    const due = { year: 2010, month: 2, day: 3 };
    const { state } = applyOk(counterWith({ loan: 100, loanDue: due }), borrow(50));
    expect(getPlayer(state, 'p1')).toMatchObject({ loan: 150, loanDue: due });
  });

  it('keeps the due date a repaid computer loan left behind', () => {
    const due = { year: 2010, month: 2, day: 3 };
    const { state } = applyOk(counterWith({ loan: 0, loanDue: due }), borrow(50));
    expect(getPlayer(state, 'p1').loanDue).toEqual(due);
  });

  it('moves the due date past Sundays and rest days, not other holidays', () => {
    const holidays: HolidayRule[] = [
      { date: { kind: 'solar', month: 4, day: 5 }, restDay: true, disabled: false, event: 0 },
      { date: { kind: 'solar', month: 4, day: 6 }, restDay: false, disabled: false, event: 0 },
    ];
    // 4 January + 90 days is Sunday 4 April; Monday 5 April is a rest day; 6 April is not.
    const start = {
      ...game({ ...BOARD, holidays }),
      date: { year: 2010, month: 1, day: 4 },
      day: 3,
    };
    const { state } = applyOk(atCounter(start), borrow(1));
    expect(getPlayer(state, 'p1').loanDue).toEqual({ year: 2010, month: 4, day: 6 });
  });

  it('accepts 1 and the limit, refuses more as insufficientFunds and less as invalidAction', () => {
    const state = atCounter();
    expect(applyAction(state, borrow(1)).ok).toBe(true);
    expect(applyAction(state, borrow(40_000)).ok).toBe(true);
    expect(applyAction(state, borrow(40_001))).toEqual({
      ok: false,
      error: { code: 'insufficientFunds' },
    });
    for (const action of [borrow(0), borrow(-3), borrow(1.5)]) {
      expect(applyAction(state, action)).toEqual({ ok: false, error: { code: 'invalidAction' } });
    }
  });

  it('is refused as insufficientFunds once the loan reaches net worth', () => {
    const state = counterWith({ cash: 0, deposit: 500, loan: 500, loanDue: DUE });
    expect(applyAction(state, borrow(1))).toEqual({
      ok: false,
      error: { code: 'insufficientFunds' },
    });
  });
});

describe('repaying', () => {
  it('takes the deposit first, then cash, keeps the due date while some is owed, and ends the turn', () => {
    const state = counterWith({ cash: 100, deposit: 50, loan: 300, loanDue: DUE });
    const { state: next, events } = applyOk(state, repay(120));
    expect(events).toEqual([
      { type: 'LoanRepaid', playerId: 'p1', amount: 120, loan: 180, loanDue: DUE, by: 'counter' },
      { type: 'TurnStarted', playerId: 'p2', round: 1 },
    ]);
    expect(getPlayer(next, 'p1')).toMatchObject({ cash: 30, deposit: 0, loan: 180, loanDue: DUE });
  });

  it('clears the due date once the loan is repaid', () => {
    const { state, events } = applyOk(counterWith({ loan: 300, loanDue: DUE }), repay(300));
    expect(events[0]).toEqual({
      type: 'LoanRepaid',
      playerId: 'p1',
      amount: 300,
      loan: 0,
      loanDue: null,
      by: 'counter',
    });
    expect(getPlayer(state, 'p1')).toMatchObject({ deposit: 19_700, loan: 0, loanDue: null });
    expect(checkInvariants(state)).toEqual([]);
  });

  it('refuses more than cash and deposit as insufficientFunds, more than the loan as invalidAction', () => {
    const state = counterWith({ cash: 100, deposit: 50, loan: 300, loanDue: DUE });
    expect(applyAction(state, repay(151))).toEqual({
      ok: false,
      error: { code: 'insufficientFunds' },
    });
    expect(applyAction(state, repay(300))).toEqual({
      ok: false,
      error: { code: 'insufficientFunds' },
    });
    const rich = counterWith({ loan: 300, loanDue: DUE });
    for (const action of [repay(301), repay(0), repay(2.5)]) {
      expect(applyAction(rich, action)).toEqual({ ok: false, error: { code: 'invalidAction' } });
    }
    expect(applyAction(atCounter(), repay(1))).toEqual({
      ok: false,
      error: { code: 'invalidAction' },
    });
  });
});

describe('counter actions', () => {
  it('are refused outside the counter and from other players', () => {
    expect(applyAction(game(), borrow(1))).toEqual({
      ok: false,
      error: { code: 'wrongPhase', phase: 'awaitRoll' },
    });
    const banked = applyOk(withFixedDice(game(), [1]), { type: 'rollDice', playerId: 'p1' }).state;
    expect(applyAction(banked, leave())).toEqual({
      ok: false,
      error: { code: 'wrongPhase', phase: 'bank' },
    });
    expect(applyAction(atCounter(), repay(1, 'p2'))).toEqual({
      ok: false,
      error: { code: 'notYourTurn' },
    });
    expect(applyAction(atCounter(), leaveBank())).toEqual({
      ok: false,
      error: { code: 'wrongPhase', phase: 'bankCounter' },
    });
  });

  it('rejects malformed amounts as invalidAction', () => {
    const malformed: unknown[] = [
      { type: 'borrow', playerId: 'p1' },
      { type: 'repay', playerId: 'p1', amount: '5' },
    ];
    for (const action of malformed) {
      expect(applyAction(atCounter(), action as Action)).toEqual({
        ok: false,
        error: { code: 'invalidAction' },
      });
    }
  });

  it('leave the counter for a computer seat, never for a human', () => {
    const state = atCounter();
    expect(computerAction(state, 'p1')).toBeNull();
    const computer = patchPlayer(state, 'p1', {
      controller: 'computer',
      profile: { cashPercent: 50, loanPercent: 50 },
    });
    expect(computerAction(computer, 'p1')).toEqual(leave());
  });

  it('show the counter to clients', () => {
    expect(viewFor(atCounter(), { kind: 'spectator' }).turn.phase).toEqual(COUNTER);
  });
});

describe('counter phase invariants', () => {
  const at = (phase: Phase, tile = 1) => patchTurn(placePlayer(game(), 'p1', tile), { phase });

  it('hold for a human at a bank counter', () => {
    expect(checkInvariants(at(COUNTER))).toEqual([]);
  });

  it('report a counter away from the player, off a bank, or for a computer', () => {
    expect(checkInvariants(at(COUNTER, 3))).toEqual([
      'phase bankCounter: tile 1 is not where p1 stands (3)',
    ]);
    expect(checkInvariants(at({ kind: 'bankCounter', tile: 2 }, 2))).toEqual([
      'phase bankCounter: tile 2 is not a bank',
    ]);
    const computer = patchPlayer(at(COUNTER), 'p1', {
      controller: 'computer',
      profile: { cashPercent: 50, loanPercent: 50 },
    });
    expect(checkInvariants(computer)).toEqual(['phase bankCounter: p1 is not a human']);
  });
});
