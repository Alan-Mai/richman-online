import { describe, expect, it } from 'vitest';
import { pay, type Debt } from './money';
import type { GameState } from './state';
import { getPlayer, loopBoard, newTestGame, patchPlayer, patchTile } from './testing';

const BOARD = loopBoard([null, 100, 200, 300, 400, null]);

/** p1 owes; p2 is the creditor; p3 stands by. */
function game(money: { cash: number; deposit: number }): GameState {
  const state = newTestGame({ board: BOARD, playerCount: 3 });
  return patchPlayer(patchPlayer(state, 'p1', money), 'p2', { cash: 1000, deposit: 1000 });
}

const rent = (amount: number): Debt => ({ kind: 'rent', tile: 3, creditor: 'p2', amount });

describe('pay when the debtor can cover it', () => {
  it('takes it from cash when cash exceeds the debt', () => {
    const result = pay(game({ cash: 600, deposit: 50 }), 'p1', rent(500));
    expect(result.bankrupt).toBe(false);
    expect(result.events).toEqual([]);
    expect(getPlayer(result.state, 'p1')).toMatchObject({ cash: 100, deposit: 50 });
    expect(getPlayer(result.state, 'p2')).toMatchObject({ cash: 1000, deposit: 1500 });
  });

  it('empties cash without touching the deposit when cash is exactly the debt', () => {
    const result = pay(game({ cash: 500, deposit: 50 }), 'p1', rent(500));
    expect(result.bankrupt).toBe(false);
    expect(result.events).toEqual([]);
    expect(getPlayer(result.state, 'p1')).toMatchObject({ cash: 0, deposit: 50, bankrupt: false });
  });

  it('takes the shortfall from the deposit', () => {
    const result = pay(game({ cash: 300, deposit: 400 }), 'p1', rent(500));
    expect(result.bankrupt).toBe(false);
    expect(result.events).toEqual([{ type: 'DepositWithdrawn', playerId: 'p1', amount: 200 }]);
    expect(getPlayer(result.state, 'p1')).toMatchObject({ cash: 0, deposit: 200 });
    expect(getPlayer(result.state, 'p2')).toMatchObject({ cash: 1000, deposit: 1500 });
  });

  it('is not bankruptcy when the deposit exactly covers the rest', () => {
    const result = pay(game({ cash: 300, deposit: 200 }), 'p1', rent(500));
    expect(result.bankrupt).toBe(false);
    expect(result.events).toEqual([{ type: 'DepositWithdrawn', playerId: 'p1', amount: 200 }]);
    expect(getPlayer(result.state, 'p1')).toMatchObject({ cash: 0, deposit: 0, bankrupt: false });
    expect(getPlayer(result.state, 'p2')).toMatchObject({ cash: 1000, deposit: 1500 });
  });

  it('pays entirely from the deposit when cash is 0', () => {
    const result = pay(game({ cash: 0, deposit: 900 }), 'p1', rent(500));
    expect(result.events).toEqual([{ type: 'DepositWithdrawn', playerId: 'p1', amount: 500 }]);
    expect(getPlayer(result.state, 'p1')).toMatchObject({ cash: 0, deposit: 400 });
  });

  it('does nothing for a zero debt', () => {
    const state = game({ cash: 0, deposit: 0 });
    const result = pay(state, 'p1', rent(0));
    expect(result).toEqual({ state, events: [], bankrupt: false, releasedTiles: [] });
  });

  it('takes system debts without paying anyone', () => {
    const state = game({ cash: 300, deposit: 300 });
    const result = pay(state, 'p1', { kind: 'system', amount: 500 });
    expect(getPlayer(result.state, 'p1')).toMatchObject({ cash: 0, deposit: 100 });
    expect(result.state.players.slice(1)).toEqual(state.players.slice(1));
  });
});

describe('pay when the debtor cannot cover it', () => {
  it('goes bankrupt when one short', () => {
    const result = pay(game({ cash: 300, deposit: 199 }), 'p1', rent(500));
    expect(result.bankrupt).toBe(true);
    expect(getPlayer(result.state, 'p1')).toMatchObject({ cash: 0, deposit: 0, bankrupt: true });
  });

  it('pays the creditor everything the debtor had left', () => {
    const paid = 500;
    const state = game({ cash: 300, deposit: 200 });
    const result = pay(state, 'p1', rent(1000));
    expect(result.bankrupt).toBe(true);
    expect(result.events).toEqual([
      {
        type: 'PlayerBankrupt',
        playerId: 'p1',
        creditor: 'p2',
        paidToCreditor: paid,
        releasedTiles: [],
        cause: { kind: 'rent', tile: 3, amountDue: 1000 },
      },
    ]);
    expect(getPlayer(result.state, 'p1')).toMatchObject({ cash: 0, deposit: 0, bankrupt: true });
    expect(getPlayer(result.state, 'p2')).toMatchObject({ cash: 1000, deposit: 1000 + paid });
    expect(getPlayer(result.state, 'p3')).toEqual(getPlayer(state, 'p3'));
  });

  it('pays nothing when the debtor has nothing left', () => {
    const result = pay(game({ cash: 0, deposit: 0 }), 'p1', rent(10));
    expect(result.bankrupt).toBe(true);
    expect(result.events[0]).toMatchObject({ type: 'PlayerBankrupt', paidToCreditor: 0 });
    expect(getPlayer(result.state, 'p2')).toMatchObject({ cash: 1000, deposit: 1000 });
  });

  it('releases every tile the debtor owned and keeps their buildings', () => {
    let state = game({ cash: 0, deposit: 0 });
    state = patchTile(state, 4, { owner: 'p1', level: 3 });
    state = patchTile(state, 1, { owner: 'p1', level: 0 });
    state = patchTile(state, 2, { owner: 'p3', level: 2 });
    state = patchTile(state, 3, { owner: 'p2', level: 1 });
    const result = pay(state, 'p1', rent(10));
    expect(result.events[0]).toMatchObject({ type: 'PlayerBankrupt', releasedTiles: [1, 4] });
    expect(result.releasedTiles).toEqual([1, 4]);
    expect(result.state.tiles).toEqual([
      { owner: null, level: 0 },
      { owner: null, level: 0 },
      { owner: 'p3', level: 2 },
      { owner: 'p2', level: 1 },
      { owner: null, level: 3 },
      { owner: null, level: 0 },
    ]);
  });

  it('puts what is left of a system debt into the lottery pool', () => {
    const state = game({ cash: 300, deposit: 200 });
    const result = pay(state, 'p1', { kind: 'system', amount: 1000 });
    expect(result.events).toEqual([
      {
        type: 'PlayerBankrupt',
        playerId: 'p1',
        creditor: null,
        paidToCreditor: 0,
        releasedTiles: [],
        cause: { kind: 'system', amountDue: 1000 },
      },
    ]);
    expect(getPlayer(result.state, 'p1')).toMatchObject({ cash: 0, deposit: 0, bankrupt: true });
    expect(result.state.players.slice(1)).toEqual(state.players.slice(1));
    expect(result.state.lotteryPool).toBe(500);
  });

  it('pays a rent bankruptcy to the creditor, not the lottery pool', () => {
    const result = pay(game({ cash: 300, deposit: 200 }), 'p1', rent(1000));
    expect(result.state.lotteryPool).toBe(0);
  });
});

describe('pay a loan back', () => {
  const DUE = { year: 2010, month: 4, day: 1 };
  /** p1 owes the bank `loan`, due on DUE. */
  const borrower = (money: { cash: number; deposit: number }, loan: number) =>
    patchPlayer(game(money), 'p1', { loan, loanDue: DUE });
  const loan = (amount: number): Debt => ({ kind: 'loan', amount });

  it('takes the deposit first, then cash, and lowers the loan; the due date is the caller’s', () => {
    const result = pay(borrower({ cash: 100, deposit: 50 }, 300), 'p1', loan(120));
    expect(result.bankrupt).toBe(false);
    expect(result.events).toEqual([]);
    expect(getPlayer(result.state, 'p1')).toMatchObject({
      cash: 30,
      deposit: 0,
      loan: 180,
      loanDue: DUE,
    });
    // Nobody is paid.
    expect(result.state.players.slice(1)).toEqual(game({ cash: 0, deposit: 0 }).players.slice(1));
    expect(result.state.lotteryPool).toBe(0);
  });

  it('leaves cash alone when the deposit covers it', () => {
    const result = pay(borrower({ cash: 100, deposit: 500 }, 300), 'p1', loan(300));
    expect(getPlayer(result.state, 'p1')).toMatchObject({ cash: 100, deposit: 200, loan: 0 });
  });

  it('bankrupts the borrower when deposit and cash fall short, writing the rest off', () => {
    let state = borrower({ cash: 30, deposit: 20 }, 100);
    state = patchTile(state, 1, { owner: 'p1', level: 1 });
    const result = pay(state, 'p1', loan(100));
    expect(result.bankrupt).toBe(true);
    expect(result.releasedTiles).toEqual([1]);
    expect(result.events).toEqual([
      {
        type: 'PlayerBankrupt',
        playerId: 'p1',
        creditor: null,
        paidToCreditor: 0,
        releasedTiles: [1],
        cause: { kind: 'loan', amountDue: 100 },
      },
    ]);
    expect(getPlayer(result.state, 'p1')).toMatchObject({
      cash: 0,
      deposit: 0,
      loan: 0,
      loanDue: null,
      bankrupt: true,
    });
    // Unlike a system debt, the money left does not go into the lottery pool.
    expect(result.state.lotteryPool).toBe(0);
  });

  it('refuses to take back more than the loan (caller bug)', () => {
    expect(() => pay(borrower({ cash: 999, deposit: 0 }, 100), 'p1', loan(101))).toThrow(
      RangeError,
    );
  });
});

describe('any bankruptcy', () => {
  it('writes the loan and its due date off', () => {
    const state = patchPlayer(game({ cash: 10, deposit: 0 }), 'p1', {
      loan: 5000,
      loanDue: { year: 2010, month: 4, day: 1 },
    });
    for (const debt of [rent(500), { kind: 'system', amount: 500 } as const]) {
      const result = pay(state, 'p1', debt);
      expect(result.bankrupt).toBe(true);
      expect(getPlayer(result.state, 'p1')).toMatchObject({ loan: 0, loanDue: null });
    }
  });
});

describe('pay contract', () => {
  it('does not mutate the input state', () => {
    let state = game({ cash: 10, deposit: 10 });
    state = patchTile(state, 1, { owner: 'p1', level: 2 });
    const snapshot = JSON.stringify(state);
    pay(state, 'p1', rent(5));
    pay(state, 'p1', rent(15));
    pay(state, 'p1', rent(500));
    expect(JSON.stringify(state)).toBe(snapshot);
  });

  it('throws on a negative amount (caller bug)', () => {
    expect(() => pay(game({ cash: 10, deposit: 0 }), 'p1', rent(-1))).toThrow(RangeError);
  });
});
