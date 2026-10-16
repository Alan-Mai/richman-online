// @vitest-environment happy-dom
import type { ServerUpdate } from '@richman/shared';
import { describe, expect, it } from 'vitest';
import type { Intent } from '../net/connection';
import { hotSeatSetup, playRandomGame } from '../testing/random-game';
import {
  COUNTER_SLIDER_LAST,
  CounterPanel,
  INITIAL_COUNTER_ENTRY,
  confirmCounter,
  counterDoneMessage,
  counterKeyFor,
  counterOffer,
  counterSliderAmount,
  counterSliderPosition,
  pressCounterKey,
  type CounterEntry,
  type CounterKey,
  type CounterOffer,
} from './counter-panel';

const OFFER: CounterOffer = { tile: 5, borrowMax: 5000, repayMax: 150, loan: 300 };

function press(keys: CounterKey[], offer: CounterOffer = OFFER): CounterEntry {
  return keys.reduce((entry, key) => pressCounterKey(entry, key, offer), INITIAL_COUNTER_ENTRY);
}

const digits = (...ds: number[]): CounterKey[] => ds.map((digit) => ({ kind: 'digit', digit }));
const borrow: CounterKey = { kind: 'choose', mode: 'borrow' };
const repay: CounterKey = { kind: 'choose', mode: 'repay' };

describe('counterOffer', () => {
  const updates = playRandomGame(hotSeatSetup(51));
  const atCounter = updates.find(
    (u) => u.view.turn.phase.kind === 'bankCounter' && u.legalActions.length > 0,
  );

  it('reads the borrowing and repayment limits and the loan', () => {
    expect(atCounter).toBeDefined();
    const update = atCounter as ServerUpdate;
    const offer = counterOffer(update);
    const maxOf = (type: string) => {
      const option = update.legalActions.find((a) => a.type === type);
      return option && 'max' in option ? option.max : null;
    };
    const player = update.view.players.find((p) => p.id === update.view.turn.current);
    expect(offer).toMatchObject({
      borrowMax: maxOf('borrow'),
      repayMax: maxOf('repay'),
      loan: player?.loan,
    });
  });

  it('is null outside a counter', () => {
    expect(counterOffer(null)).toBeNull();
    expect(counterOffer(updates[0] ?? null)).toBeNull();
  });
});

describe('counter entry', () => {
  it('opens the field for borrowing, or says the limit is reached', () => {
    expect(press([borrow])).toEqual({ kind: 'field', mode: 'borrow', digits: '0', notice: null });
    expect(press([borrow], { ...OFFER, borrowMax: null })).toEqual({
      kind: 'menu',
      notice: 'overLimit',
    });
  });

  it('does not open repaying when it is not offered', () => {
    expect(press([repay], { ...OFFER, repayMax: null })).toEqual(INITIAL_COUNTER_ENTRY);
  });

  it('types digits up to the field limit: the loan when repaying', () => {
    expect(press([borrow, ...digits(1, 2, 3, 4)])).toMatchObject({ digits: '1234' });
    expect(press([borrow, ...digits(9, 9, 9, 9, 9)])).toMatchObject({ digits: '5000' });
    // The field allows up to the loan, more than cash and deposit (150).
    expect(press([repay, ...digits(2, 0, 0)])).toMatchObject({ digits: '200' });
    expect(press([repay, ...digits(4, 0, 0)])).toMatchObject({ digits: '300' });
  });

  it('clears, fills, goes back and jumps like the original field', () => {
    expect(press([borrow, ...digits(1, 2), { kind: 'back' }])).toMatchObject({ digits: '1' });
    expect(press([borrow, { kind: 'fill' }])).toMatchObject({ digits: '5000' });
    expect(press([borrow, { kind: 'fill' }, { kind: 'clear' }])).toMatchObject({ digits: '0' });
    // Position 17: trunc(5000 × float32(17 ÷ 33)).
    expect(press([borrow, { kind: 'jump' }])).toMatchObject({ digits: '2575' });
  });

  it('cancels back to the menu', () => {
    expect(press([borrow, ...digits(5), { kind: 'cancel' }])).toEqual(INITIAL_COUNTER_ENTRY);
  });
});

describe('the counter slider', () => {
  it('maps position i to trunc(limit × float32(i ÷ 33)), the ends being 0 and the limit', () => {
    expect(counterSliderAmount(0, 5000)).toBe(0);
    expect(counterSliderAmount(COUNTER_SLIDER_LAST, 5000)).toBe(5000);
    expect(counterSliderAmount(1, 33)).toBe(1);
  });

  it('shows an amount at trunc(float32(amount ÷ limit) × 33), which float32 can put a step low', () => {
    expect(counterSliderPosition(0, 33)).toBe(0);
    expect(counterSliderPosition(33, 33)).toBe(33);
    // float32(17 ÷ 33) × 33 is just under 17.
    expect(counterSliderPosition(17, 33)).toBe(16);
    expect(counterSliderPosition(16, 33)).toBe(16);
    // The same in single precision as the slider's own amounts: position 17 of 33 is 16.
    expect(counterSliderAmount(17, 33)).toBe(16);
  });
});

describe('confirmCounter', () => {
  it('sends the borrowing or repayment', () => {
    expect(confirmCounter(press([borrow, ...digits(7)]), OFFER)).toEqual({
      send: { type: 'borrow', amount: 7 },
    });
    expect(confirmCounter(press([repay, ...digits(1, 5, 0)]), OFFER)).toEqual({
      send: { type: 'repay', amount: 150 },
    });
  });

  it('goes back to the menu on 0', () => {
    expect(confirmCounter(press([borrow]), OFFER)).toEqual({ entry: INITIAL_COUNTER_ENTRY });
  });

  it('says cash is short and opens the field again when repaying more than there is', () => {
    expect(confirmCounter(press([repay, ...digits(2, 0, 0)]), OFFER)).toEqual({
      entry: { kind: 'field', mode: 'repay', digits: '0', notice: 'shortOfCash' },
    });
  });
});

describe('counterDoneMessage', () => {
  const due = { year: 2010, month: 4, day: 2 };

  it('says what the counter did, and nothing for a computer or other events', () => {
    expect(
      counterDoneMessage({
        type: 'LoanBorrowed',
        playerId: 'p1',
        amount: 300,
        loan: 300,
        loanDue: due,
        by: 'counter',
      }),
    ).toBe('借款 300 已存入存款，2010/4/2 到期');
    expect(
      counterDoneMessage({
        type: 'LoanRepaid',
        playerId: 'p1',
        amount: 300,
        loan: 0,
        loanDue: null,
        by: 'counter',
      }),
    ).toBe('已還款 300，貸款已還清');
    expect(
      counterDoneMessage({
        type: 'LoanRepaid',
        playerId: 'p1',
        amount: 300,
        loan: 0,
        loanDue: due,
        by: 'computer',
      }),
    ).toBeNull();
    expect(counterDoneMessage({ type: 'TurnStarted', playerId: 'p1', round: 1 })).toBeNull();
  });
});

describe('counterKeyFor', () => {
  it('maps digits, Backspace, Enter, Escape and the C, M and H keys', () => {
    expect(counterKeyFor('4')).toEqual({ kind: 'digit', digit: 4 });
    expect(counterKeyFor('Backspace')).toEqual({ kind: 'back' });
    expect(counterKeyFor('Enter')).toBe('confirm');
    expect(counterKeyFor('Escape')).toEqual({ kind: 'cancel' });
    expect(counterKeyFor('c')).toEqual({ kind: 'clear' });
    expect(counterKeyFor('M')).toEqual({ kind: 'fill' });
    expect(counterKeyFor('h')).toEqual({ kind: 'jump' });
    expect(counterKeyFor('x')).toBeNull();
  });
});

describe('CounterPanel', () => {
  function panel() {
    const root = document.createElement('section');
    const keys: CounterKey[] = [];
    const acts: Intent[] = [];
    let confirms = 0;
    const counter = new CounterPanel(root, {
      onKey: (key) => keys.push(key),
      onConfirm: () => confirms++,
      onAct: (intent) => acts.push(intent),
    });
    const view = (entry: CounterEntry, offer: CounterOffer = OFFER) => ({
      offer,
      entry,
      tileName: '銀行',
      cash: 100,
      deposit: 50,
      loan: 300,
      netWorth: 1000,
    });
    return { root, keys, acts, counter, view, confirms: () => confirms };
  }

  it('shows the menu, with repaying disabled when not offered, and leaves', () => {
    const { root, keys, acts, counter, view } = panel();
    counter.render(view(INITIAL_COUNTER_ENTRY, { ...OFFER, repayMax: null }));
    expect(root.hidden).toBe(false);
    const borrowButton = root.querySelector<HTMLButtonElement>('[data-mode="borrow"]');
    const repayButton = root.querySelector<HTMLButtonElement>('[data-mode="repay"]');
    expect(repayButton?.disabled).toBe(true);
    borrowButton?.click();
    expect(keys).toEqual([borrow]);
    [...root.querySelectorAll('button')].find((b) => b.textContent === '離開櫃檯')?.click();
    expect(acts).toEqual([{ type: 'leaveCounter' }]);
  });

  it('shows the field with the amount, limit, slider and notice', () => {
    const { root, counter, view, confirms } = panel();
    const entry: CounterEntry = {
      kind: 'field',
      mode: 'repay',
      digits: '0',
      notice: 'shortOfCash',
    };
    counter.render(view(entry));
    expect(root.querySelector('.counter-notice')?.textContent).toBe('現金與存款不足以還這個金額');
    expect(root.querySelector('.counter-limit')?.textContent).toContain('300');
    counter.render(view({ ...entry, digits: '150', notice: null }));
    expect(root.querySelector<HTMLInputElement>('.counter-slider')?.value).toBe('16');
    [...root.querySelectorAll('button')].find((b) => b.textContent === '確認')?.click();
    expect(confirms()).toBe(1);
  });

  it('shows the closing message after a borrowing or repayment', () => {
    const { root, counter, view } = panel();
    counter.render(view({ kind: 'done', message: '已還款 120，貸款剩 180', notice: null }));
    expect(root.querySelector('.counter-done')?.textContent).toBe('已還款 120，貸款剩 180');
    expect(root.querySelectorAll('button')).toHaveLength(0);
  });

  it('hides when closed', () => {
    const { root, counter, view } = panel();
    counter.render(view(INITIAL_COUNTER_ENTRY));
    counter.render(null);
    expect(root.hidden).toBe(true);
  });
});
