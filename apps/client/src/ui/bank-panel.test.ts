// @vitest-environment happy-dom
import type { LegalAction, ServerUpdate } from '@richman/shared';
import { describe, expect, it } from 'vitest';
import type { Intent } from '../net/connection';
import { hotSeatSetup, playRandomGame } from '../testing/random-game';
import {
  BankPanel,
  bankAmount,
  bankKeyFor,
  bankOffer,
  confirmIntent,
  initialBankEntry,
  pressBankKey,
  sliderAmount,
  sliderStep,
  type BankEntry,
  type BankKey,
  type BankOffer,
} from './bank-panel';

const OFFER: BankOffer = { tile: 5, trigger: 'pass', max: { withdraw: 1000, deposit: 300 } };

function press(keys: BankKey[], offer: BankOffer = OFFER): BankEntry {
  return keys.reduce((entry, key) => pressBankKey(entry, key, offer), initialBankEntry(offer));
}

const digits = (...ds: number[]): BankKey[] => ds.map((digit) => ({ kind: 'digit', digit }));

describe('bankOffer', () => {
  const updates = playRandomGame(hotSeatSetup(51));
  const atBank = updates.find((u) => u.view.turn.phase.kind === 'bank' && u.legalActions.length);

  it('reads each mode limit from the offered ranges', () => {
    expect(atBank).toBeDefined();
    const update = atBank as ServerUpdate;
    const offer = bankOffer(update);
    const phase = update.view.turn.phase;
    expect(phase.kind).toBe('bank');
    if (phase.kind !== 'bank') return;
    const limit = (direction: string) =>
      update.legalActions.find(
        (a): a is Extract<LegalAction, { type: 'bankTransfer' }> =>
          a.type === 'bankTransfer' && a.direction === direction,
      )?.max ?? null;
    expect(offer).toEqual({
      tile: phase.tile,
      trigger: phase.trigger.kind,
      max: { withdraw: limit('withdraw'), deposit: limit('deposit') },
    });
  });

  it('is null outside a bank and while playing', () => {
    expect(bankOffer(null)).toBeNull();
    expect(bankOffer(updates[0] ?? null)).toBeNull();
  });
});

describe('bank entry', () => {
  it('opens on withdrawing at 0, or on depositing when only that is offered', () => {
    expect(initialBankEntry(OFFER)).toEqual({ mode: 'withdraw', digits: '0' });
    const depositOnly = { ...OFFER, max: { withdraw: null, deposit: 300 } };
    expect(initialBankEntry(depositOnly).mode).toBe('deposit');
  });

  it('types digits, replacing the leading 0, capped at the limit', () => {
    expect(bankAmount(press(digits(0, 4, 2)))).toBe(42);
    expect(bankAmount(press(digits(9, 9, 9, 9)))).toBe(1000);
  });

  it('takes at most 9 digits', () => {
    const big = { ...OFFER, max: { withdraw: 10_000_000_000, deposit: null } };
    expect(press(digits(1, 2, 3, 4, 5, 6, 7, 8, 9, 1), big).digits).toBe('123456789');
  });

  it('clears, fills to the limit and deletes the last digit', () => {
    expect(press([...digits(4, 2), { kind: 'clear' }]).digits).toBe('0');
    expect(press([{ kind: 'fill' }]).digits).toBe('1000');
    expect(press([...digits(4, 2), { kind: 'back' }]).digits).toBe('4');
    expect(press([...digits(4), { kind: 'back' }, { kind: 'back' }]).digits).toBe('0');
  });

  it('switches modes back to 0, but not to a mode that is not offered', () => {
    const switched = press([...digits(5), { kind: 'mode', mode: 'deposit' }]);
    expect(switched).toEqual({ mode: 'deposit', digits: '0' });
    expect(bankAmount(press([{ kind: 'mode', mode: 'deposit' }, ...digits(9, 9, 9)]))).toBe(300);
    const noDeposit = { ...OFFER, max: { withdraw: 1000, deposit: null } };
    expect(press([...digits(5), { kind: 'mode', mode: 'deposit' }], noDeposit).mode).toBe(
      'withdraw',
    );
  });

  it("sets the amount from the original's 34-step slider", () => {
    // ⌊1000 ÷ 34⌋ + 1 = 30 per step.
    expect([0, 1, 33, 34].map((step) => sliderAmount(step, 1000))).toEqual([0, 30, 990, 1000]);
    // Small limits reach the top before the last step.
    expect([1, 10, 11, 34].map((step) => sliderAmount(step, 10))).toEqual([1, 10, 10, 10]);
    expect(press([{ kind: 'slider', step: 2 }])).toEqual({ mode: 'withdraw', digits: '60' });
  });

  it('shows any amount on the slider at the step below it, like the original', () => {
    // trunc(amount ÷ limit × 34).
    expect([0, 29, 30, 500, 999, 1000].map((amount) => sliderStep(amount, 1000))).toEqual([
      0, 0, 1, 17, 33, 34,
    ]);
    // A step picked on a small limit can show further along: 1 of 10 is 3.4 steps.
    expect(sliderStep(sliderAmount(1, 10), 10)).toBe(3);
    // Amounts exactly on a step land on it: in double precision (the original's FPU setting)
    // fl(k ÷ 34) × 34 rounds back to k for every k, whatever the limit.
    const steps = Array.from({ length: 35 }, (_, k) => k);
    expect(steps.map((k) => sliderStep(k, 34))).toEqual(steps);
    expect(steps.map((k) => sliderStep(k * 29_411_764, 999_999_976))).toEqual(steps);
    expect(sliderStep(0, 0)).toBe(0);
  });

  it('confirms a transfer, or leaving the bank at 0', () => {
    expect(confirmIntent(press(digits(4, 2)))).toEqual({
      type: 'bankTransfer',
      direction: 'withdraw',
      amount: 42,
    });
    expect(confirmIntent(initialBankEntry(OFFER))).toEqual({ type: 'leaveBank' });
  });

  it('maps physical keys', () => {
    expect(bankKeyFor('7')).toEqual({ kind: 'digit', digit: 7 });
    expect(bankKeyFor('Backspace')).toEqual({ kind: 'back' });
    expect(bankKeyFor('Enter')).toBe('confirm');
    expect(bankKeyFor('Escape')).toBe('cancel');
    expect(bankKeyFor('d')).toBeNull();
  });
});

describe('BankPanel', () => {
  function setup() {
    const root = document.createElement('section');
    const keys: BankKey[] = [];
    const acted: Intent[] = [];
    const panel = new BankPanel(root, {
      onKey: (key) => keys.push(key),
      onAct: (intent) => acted.push(intent),
    });
    const show = (entry: BankEntry) =>
      panel.render({ offer: OFFER, entry, tileName: '測試銀行', cash: 300, deposit: 1000 });
    return { root, panel, keys, acted, show };
  }

  it('shows the amount, the limit and the modes, and reports keys and actions', () => {
    const { root, keys, acted, show } = setup();
    show({ mode: 'withdraw', digits: '42' });
    expect(root.hidden).toBe(false);
    expect(root.querySelector('h2')?.textContent).toBe('經過 測試銀行');
    expect(root.querySelector('.bank-amount')?.textContent).toBe('42');
    expect(root.querySelector('.bank-limit')?.textContent).toBe('上限 1,000');
    const modes = [...root.querySelectorAll<HTMLButtonElement>('.bank-mode')];
    expect(modes.map((b) => b.getAttribute('aria-pressed'))).toEqual(['true', 'false']);

    const key = (text: string) =>
      [...root.querySelectorAll<HTMLButtonElement>('.bank-key')].find(
        (b) => b.textContent === text,
      );
    key('7')?.click();
    key('C')?.click();
    key('M')?.click();
    key('←')?.click();
    modes[1]?.click();
    expect(keys).toEqual([
      { kind: 'digit', digit: 7 },
      { kind: 'clear' },
      { kind: 'fill' },
      { kind: 'back' },
      { kind: 'mode', mode: 'deposit' },
    ]);

    const [confirm, cancel] = [...root.querySelectorAll<HTMLButtonElement>('.bank-actions button')];
    confirm?.click();
    cancel?.click();
    expect(acted).toEqual([
      { type: 'bankTransfer', direction: 'withdraw', amount: 42 },
      { type: 'leaveBank' },
    ]);
  });

  it('keeps the same slider while the dialog stays open, and reports its steps', () => {
    const { root, keys, show } = setup();
    show({ mode: 'withdraw', digits: '0' });
    const slider = root.querySelector<HTMLInputElement>('.bank-slider')!;
    slider.value = '5';
    slider.dispatchEvent(new Event('input'));
    show({ mode: 'withdraw', digits: '150' });
    expect(root.querySelector('.bank-slider')).toBe(slider);
    expect(slider.value).toBe('5');
    expect(keys).toEqual([{ kind: 'slider', step: 5 }]);
  });

  it('moves the slider with typed amounts', () => {
    const { root, show } = setup();
    show({ mode: 'withdraw', digits: '500' });
    const slider = root.querySelector<HTMLInputElement>('.bank-slider')!;
    expect(slider.value).toBe('17');
    show({ mode: 'withdraw', digits: '1000' });
    expect(slider.value).toBe('34');
    // Deposit limit 300: 150 is half way.
    show({ mode: 'deposit', digits: '150' });
    expect(slider.value).toBe('17');
  });

  it('hides when closed', () => {
    const { root, panel, show } = setup();
    show(initialBankEntry(OFFER));
    panel.render(null);
    expect(root.hidden).toBe(true);
    expect(root.children).toHaveLength(0);
  });
});
