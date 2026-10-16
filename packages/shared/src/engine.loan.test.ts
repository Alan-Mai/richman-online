import { describe, expect, it } from 'vitest';
import type { GameEvent } from './events';
import { checkInvariants } from './invariants';
import type { CharacterProfile } from './profile';
import type { GameState } from './state';
import {
  applyOk,
  getPlayer,
  loopBoard,
  newTestGame,
  patchPlayer,
  patchTile,
  scriptedRng,
} from './testing';

/** 0 blank, 1 bank, 2 property (1000), 3 bank, 4 and 5 blank. */
const BOARD = loopBoard([null, 'bank', 1000, 'bank', null, null]);
const DUE = { year: 2010, month: 4, day: 1 };

/**
 * Computer p1 (on tile 0) with `profile` and `money`, rolling `face` and then drawing `draws` for
 * the loan decision. Mid-month, so rebalancing at 50% leaves an even split alone.
 */
function computerGame(
  money: Partial<Pick<GameState['players'][number], 'cash' | 'deposit' | 'loan' | 'loanDue'>>,
  profile: CharacterProfile = { cashPercent: 50, loanPercent: 50 },
  face = 1,
  draws: number[] = [],
): GameState {
  const start = newTestGame({ board: BOARD, controllers: ['computer', 'human'] });
  const mid = { ...start, date: { year: 2010, month: 1, day: 15 }, day: 14 };
  const state = patchPlayer(mid, 'p1', { profile, ...money });
  return { ...state, rngState: scriptedRng([face - 1, ...draws]) };
}

function roll(state: GameState): { state: GameState; events: GameEvent[] } {
  return applyOk(state, { type: 'rollDice', playerId: 'p1' });
}

const loanEvents = (events: GameEvent[]) =>
  events.filter((e) => e.type === 'LoanBorrowed' || e.type === 'LoanRepaid');

describe('a computer without a loan stopping on a bank', () => {
  it('borrows loanPercent of net worth into the deposit when it draws 0 out of 10', () => {
    // Net worth 20,000 + 20,000 + 1000 (property) = 41,000; 30% is 12,300.
    let start = computerGame(
      { cash: 20_000, deposit: 20_000 },
      { cashPercent: 50, loanPercent: 30 },
    );
    start = patchTile(start, 2, { owner: 'p1', level: 0 });
    const { state, events } = roll({ ...start, rngState: scriptedRng([0, 0]) });
    expect(loanEvents(events)).toEqual([
      { type: 'LoanBorrowed', playerId: 'p1', amount: 12_300, loan: 12_300, loanDue: DUE_MID },
    ]);
    expect(getPlayer(state, 'p1')).toMatchObject({
      cash: 20_000,
      deposit: 32_300,
      loan: 12_300,
      loanDue: DUE_MID,
    });
    expect(state.turn.current).toBe('p2');
    expect(checkInvariants(state)).toEqual([]);
  });

  it('does not borrow on another draw with cash and deposit of 30,000 or more', () => {
    const { state, events } = roll(
      computerGame({ cash: 15_000, deposit: 15_000 }, undefined, 1, [3]),
    );
    expect(loanEvents(events)).toEqual([]);
    expect(getPlayer(state, 'p1')).toMatchObject({ loan: 0, loanDue: null });
    // The draw was used up.
    expect(state.rngState).toEqual(scriptedRng([]));
  });

  it('borrows on any draw with less than 30,000, unmultiplied by the price index', () => {
    const start = {
      ...computerGame({ cash: 14_999, deposit: 15_000 }, undefined, 1, [9]),
      priceIndex: 3,
    };
    const { events } = roll(start);
    // 50% of 29,999, rounded down.
    expect(loanEvents(events)).toEqual([
      { type: 'LoanBorrowed', playerId: 'p1', amount: 14_999, loan: 14_999, loanDue: DUE_MID },
    ]);
  });

  it('never borrows with a loan share of 0, though it still draws', () => {
    const start = computerGame(
      { cash: 100, deposit: 100 },
      { cashPercent: 50, loanPercent: 0 },
      1,
      [0],
    );
    const { state, events } = roll(start);
    expect(loanEvents(events)).toEqual([]);
    expect(state.rngState).toEqual(scriptedRng([]));
  });

  it('borrows nothing when the share rounds down to 0', () => {
    const start = computerGame(
      { cash: 50, deposit: 49 },
      { cashPercent: 50, loanPercent: 1 },
      1,
      [0],
    );
    const { state, events } = roll(start);
    expect(loanEvents(events)).toEqual([]);
    expect(getPlayer(state, 'p1')).toMatchObject({ loan: 0, loanDue: null });
  });

  it('keeps a due date left by an earlier repayment', () => {
    const old = { year: 2010, month: 2, day: 1 };
    const start = computerGame({ cash: 100, deposit: 100, loanDue: old }, undefined, 1, [0]);
    const { state } = roll(start);
    expect(getPlayer(state, 'p1')).toMatchObject({ loan: 100, loanDue: old });
  });

  it('rebalances first, then borrows', () => {
    // On day 15 the target is 50%; 1000 cash of 10,000 is far off.
    const { events } = roll(computerGame({ cash: 1000, deposit: 9000 }, undefined, 1, [0]));
    expect(events.map((e) => e.type)).toEqual([
      'DiceRolled',
      'PlayerMoved',
      'BankRebalanced',
      'LoanBorrowed',
      'TurnStarted',
    ]);
  });

  it('does nothing about loans when passing a bank', () => {
    // Rolling 2 passes bank 1 and stops on the property; no draw is left for a loan decision.
    const { events } = roll(computerGame({ cash: 100, deposit: 100 }, undefined, 2));
    expect(loanEvents(events)).toEqual([]);
  });
});

describe('a computer with a loan stopping on a bank', () => {
  /** Day 15 January; DUE is 76 days on. */
  const owing = (money: { cash: number; deposit: number; loan: number }, loanDue = DUE) =>
    computerGame({ ...money, loanDue });

  it('repays all of it once due within 6 days if 1.1 times the loan is covered, keeping the due date', () => {
    const due = { year: 2010, month: 1, day: 21 };
    const { state, events } = roll(owing({ cash: 601, deposit: 500, loan: 1000 }, due));
    expect(loanEvents(events)).toEqual([
      { type: 'LoanRepaid', playerId: 'p1', amount: 1000, loan: 0, loanDue: due, by: 'computer' },
    ]);
    // Deposit first, then cash.
    expect(getPlayer(state, 'p1')).toMatchObject({ cash: 101, deposit: 0, loan: 0, loanDue: due });
    expect(checkInvariants(state)).toEqual([]);
  });

  it('repays with exactly 1.1 times the loan when the double product is exact', () => {
    // 1000 × 1.1 rounds to exactly 1100 in double precision (unlike 50 × 1.1, below).
    const due = { year: 2010, month: 1, day: 21 };
    const { events } = roll(owing({ cash: 600, deposit: 500, loan: 1000 }, due));
    expect(loanEvents(events)).toHaveLength(1);
  });

  it('waits while more than 6 days are left', () => {
    const due = { year: 2010, month: 1, day: 22 };
    const { events } = roll(owing({ cash: 601, deposit: 500, loan: 1000 }, due));
    expect(loanEvents(events)).toEqual([]);
  });

  it('waits when cash and deposit fall short of 1.1 times the loan', () => {
    const due = { year: 2010, month: 1, day: 21 };
    const { events } = roll(owing({ cash: 599, deposit: 500, loan: 1000 }, due));
    expect(loanEvents(events)).toEqual([]);
  });

  it('compares 1.1 times the loan in double precision, like the original', () => {
    // 50 × 1.1 is 55.000000000000007 in double precision: more than 55.
    const due = { year: 2010, month: 1, day: 21 };
    const { events } = roll(owing({ cash: 27, deposit: 28, loan: 50 }, due));
    expect(loanEvents(events)).toEqual([]);
    const { events: more } = roll(owing({ cash: 28, deposit: 28, loan: 50 }, due));
    expect(loanEvents(more)).toHaveLength(1);
  });

  it('repays at any time when the deposit is more than twice the loan', () => {
    // Due in 76 days; about half cash, so rebalancing leaves it alone.
    const { events } = roll(owing({ cash: 2100, deposit: 2001, loan: 1000 }));
    expect(loanEvents(events)).toEqual([
      { type: 'LoanRepaid', playerId: 'p1', amount: 1000, loan: 0, loanDue: DUE, by: 'computer' },
    ]);
    const { events: exact } = roll(owing({ cash: 2100, deposit: 2000, loan: 1000 }));
    expect(loanEvents(exact)).toEqual([]);
  });

  it('does not draw from the RNG', () => {
    const { state } = roll(owing({ cash: 601, deposit: 500, loan: 1000 }));
    expect(state.rngState).toEqual(scriptedRng([]));
  });
});

/** 15 January + 90 days: 15 April 2010, a Thursday. */
const DUE_MID = { year: 2010, month: 4, day: 15 };
