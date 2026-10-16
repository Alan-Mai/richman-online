// The bank's loan counter (docs/GAME_RULES.md §4) as a HUD section, after the bank screen when
// stopping on a bank. Like the original: a menu (borrow, repay, leave) and a number field for the
// amount, with the keys of the bank screen and its own 34-position slider. One borrowing or
// repayment per visit; cancelling the field goes back to the menu.
import type { GameEvent, ServerUpdate, TileIndex } from '@richman/shared';
import { formatMoney, t } from '../i18n';
import type { Intent } from '../net/connection';

/** The original number field: up to 9 digits, a slider of positions 0..33. */
export const COUNTER_MAX_DIGITS = 9;
export const COUNTER_SLIDER_LAST = 33;
/** The position the original's "H" key jumps to. */
export const COUNTER_SLIDER_JUMP = 17;

/** What the counter offers now. */
export interface CounterOffer {
  tile: TileIndex;
  /** How much may be borrowed; null when borrowing is not offered (the loan reached net worth). */
  borrowMax: number | null;
  /** How much may be repaid (no more than cash and deposit); null when repaying is not offered. */
  repayMax: number | null;
  /** The loan: the repay field's limit, as in the original. */
  loan: number;
}

export type CounterMode = 'borrow' | 'repay';

/** A message the counter shows in place of acting. */
export type CounterNotice = 'overLimit' | 'shortOfCash';

/** The counter's own state: its menu, or the amount field of one mode. */
export type CounterEntry =
  | { kind: 'menu'; notice: CounterNotice | null }
  | { kind: 'field'; mode: CounterMode; digits: string; notice: CounterNotice | null }
  /** The borrowing or repayment went through: its message shows before the counter closes. */
  | { kind: 'done'; message: string; notice: null };

export type CounterKey =
  | { kind: 'choose'; mode: CounterMode }
  | { kind: 'digit'; digit: number }
  | { kind: 'clear' }
  | { kind: 'fill' }
  | { kind: 'back' }
  | { kind: 'slider'; position: number }
  | { kind: 'jump' }
  | { kind: 'cancel' };

/** The counter of the ready update, or null when no counter is open for this player. */
export function counterOffer(update: ServerUpdate | null): CounterOffer | null {
  const phase = update?.view.turn.phase;
  if (update === null || phase?.kind !== 'bankCounter') return null;
  if (!update.legalActions.some((a) => a.type === 'leaveCounter')) return null;
  const maxOf = (type: CounterMode) => {
    const option = update.legalActions.find((a) => a.type === type);
    return option?.type === type ? option.max : null;
  };
  const player = update.view.players.find((p) => p.id === update.view.turn.current);
  return {
    tile: phase.tile,
    borrowMax: maxOf('borrow'),
    repayMax: maxOf('repay'),
    loan: player?.loan ?? 0,
  };
}

export const INITIAL_COUNTER_ENTRY: CounterEntry = { kind: 'menu', notice: null };

/** The field's limit: what may be borrowed, or the loan when repaying (like the original). */
export function fieldLimit(offer: CounterOffer, mode: CounterMode): number {
  return mode === 'borrow' ? (offer.borrowMax ?? 0) : offer.loan;
}

export function counterAmount(entry: CounterEntry): number {
  return entry.kind === 'field' ? Number(entry.digits) : 0;
}

/**
 * The original field's slider: position i is trunc(limit × float32(i ÷ 33)); 33 is the limit.
 * The ratio is stored in single precision and multiplied in double precision (53-bit FPU).
 */
export function counterSliderAmount(position: number, limit: number): number {
  if (position <= 0) return 0;
  if (position >= COUNTER_SLIDER_LAST) return limit;
  return Math.trunc(limit * Math.fround(position / COUNTER_SLIDER_LAST));
}

/**
 * Where the slider shows an amount, like the original's redraw: trunc(float32(amount ÷ limit) ×
 * 33); nothing filled (0) for an amount of 0.
 */
export function counterSliderPosition(amount: number, limit: number): number {
  if (amount <= 0 || limit <= 0) return 0;
  return Math.trunc(Math.fround(amount / limit) * COUNTER_SLIDER_LAST);
}

/** Applies a key; acting (confirming, leaving) is confirmCounter's and the caller's. */
export function pressCounterKey(
  entry: CounterEntry,
  key: CounterKey,
  offer: CounterOffer,
): CounterEntry {
  if (key.kind === 'choose') {
    if (key.mode === 'borrow') {
      // The original says the limit is reached instead of opening the field.
      return offer.borrowMax === null
        ? { kind: 'menu', notice: 'overLimit' }
        : { kind: 'field', mode: 'borrow', digits: '0', notice: null };
    }
    return offer.repayMax === null
      ? { kind: 'menu', notice: null }
      : { kind: 'field', mode: 'repay', digits: '0', notice: null };
  }
  if (entry.kind !== 'field') return entry;
  if (key.kind === 'cancel') return INITIAL_COUNTER_ENTRY;
  const limit = fieldLimit(offer, entry.mode);
  const set = (amount: number): CounterEntry => ({ ...entry, digits: String(amount) });
  switch (key.kind) {
    case 'digit': {
      if (entry.digits !== '0' && entry.digits.length >= COUNTER_MAX_DIGITS) return entry;
      const typed = entry.digits === '0' ? String(key.digit) : entry.digits + String(key.digit);
      return set(Math.min(Number(typed), limit));
    }
    case 'clear':
      return set(0);
    case 'fill':
      return set(limit);
    case 'back':
      return { ...entry, digits: entry.digits.length > 1 ? entry.digits.slice(0, -1) : '0' };
    case 'slider':
      return set(counterSliderAmount(key.position, limit));
    case 'jump':
      return set(counterSliderAmount(COUNTER_SLIDER_JUMP, limit));
  }
}

/**
 * Confirming the field: the borrowing or repayment to send, or the counter's next state when
 * nothing is sent. 0 goes back to the menu; repaying more than cash and deposit says so and opens
 * the field again at 0, like the original.
 */
export function confirmCounter(
  entry: CounterEntry,
  offer: CounterOffer,
): { send: Intent } | { entry: CounterEntry } {
  if (entry.kind !== 'field') return { entry };
  const amount = counterAmount(entry);
  if (amount === 0) return { entry: INITIAL_COUNTER_ENTRY };
  if (entry.mode === 'repay' && amount > (offer.repayMax ?? 0)) {
    return { entry: { ...entry, digits: '0', notice: 'shortOfCash' } };
  }
  return { send: { type: entry.mode, amount } };
}

/** The counter's message for a borrowing or repayment of its own, or null for any other event. */
export function counterDoneMessage(event: GameEvent): string | null {
  if (event.type === 'LoanBorrowed' && event.by === 'counter') {
    return t('counter.done.borrowed', { amount: formatMoney(event.amount), ...event.loanDue });
  }
  if (event.type === 'LoanRepaid' && event.by === 'counter') {
    return event.loan === 0
      ? t('counter.done.repaidAll', { amount: formatMoney(event.amount) })
      : t('counter.done.repaid', {
          amount: formatMoney(event.amount),
          loan: formatMoney(event.loan),
        });
  }
  return null;
}

/** What a physical key does while the counter is open. */
export function counterKeyFor(key: string): CounterKey | 'confirm' | null {
  if (/^[0-9]$/.test(key)) return { kind: 'digit', digit: Number(key) };
  switch (key) {
    case 'Backspace':
      return { kind: 'back' };
    case 'Enter':
      return 'confirm';
    case 'Escape':
      return { kind: 'cancel' };
    case 'c':
    case 'C':
      return { kind: 'clear' };
    case 'm':
    case 'M':
      return { kind: 'fill' };
    case 'h':
    case 'H':
      return { kind: 'jump' };
    default:
      return null;
  }
}

export interface CounterPanelView {
  offer: CounterOffer;
  entry: CounterEntry;
  tileName: string;
  cash: number;
  deposit: number;
  loan: number;
  netWorth: number;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(text: string, className: string, onClick: () => void): HTMLButtonElement {
  const node = el('button', className, text);
  node.type = 'button';
  node.addEventListener('click', onClick);
  return node;
}

/** Rebuilds the menu or the field when it changes, and updates the rest in place. */
export class CounterPanel {
  private shown: string | null = null;
  private readonly title = el('h2');
  private readonly balances = el('dl', 'counter-balances');
  private readonly notice = el('p', 'counter-notice');
  private readonly body = el('div', 'counter-body');
  private readonly amount = el('output', 'counter-amount');
  private readonly limit = el('p', 'counter-limit');
  private readonly slider = el('input', 'counter-slider');

  constructor(
    private readonly root: HTMLElement,
    private readonly handlers: {
      onKey: (key: CounterKey) => void;
      onConfirm: () => void;
      onAct: (intent: Intent) => void;
    },
  ) {
    root.hidden = true;
    this.notice.setAttribute('role', 'status');
    this.amount.setAttribute('aria-live', 'polite');
    this.slider.type = 'range';
    this.slider.min = '0';
    this.slider.max = String(COUNTER_SLIDER_LAST);
    this.slider.step = '1';
    this.slider.setAttribute('aria-label', t('counter.slider'));
    this.slider.addEventListener('input', () =>
      handlers.onKey({ kind: 'slider', position: Number(this.slider.value) }),
    );
  }

  render(view: CounterPanelView | null): void {
    if (view === null) {
      this.shown = null;
      this.root.hidden = true;
      this.root.replaceChildren();
      return;
    }
    const { offer, entry } = view;
    const layout = entry.kind === 'field' ? `field-${entry.mode}` : entry.kind;
    if (this.shown !== layout) {
      this.shown = layout;
      this.build(view);
    }
    this.title.textContent = t('counter.title', { tile: view.tileName });
    this.balances.replaceChildren(
      ...[
        [t('hud.cash'), view.cash],
        [t('hud.deposit'), view.deposit],
        [t('counter.loan'), view.loan],
        [t('hud.netWorth'), view.netWorth],
      ].flatMap(([label, value]) => [
        el('dt', undefined, String(label)),
        el('dd', undefined, formatMoney(Number(value))),
      ]),
    );
    this.notice.textContent = entry.notice === null ? '' : t(`counter.notice.${entry.notice}`);
    this.notice.hidden = entry.notice === null;
    if (entry.kind === 'field') {
      const limit = fieldLimit(offer, entry.mode);
      const amount = counterAmount(entry);
      this.amount.textContent = formatMoney(amount);
      this.limit.textContent = t('bank.limit', { max: formatMoney(limit) });
      const position = String(counterSliderPosition(amount, limit));
      if (this.slider.value !== position) this.slider.value = position;
    }
    this.root.hidden = false;
  }

  private build(view: CounterPanelView): void {
    const { onKey, onConfirm, onAct } = this.handlers;
    const { offer, entry } = view;
    if (entry.kind === 'done') {
      const message = el('p', 'counter-done', entry.message);
      message.setAttribute('role', 'status');
      this.body.replaceChildren(message);
    } else if (entry.kind === 'menu') {
      const menu = el('div', 'counter-menu');
      const borrow = button(t('action.borrow'), 'primary', () =>
        onKey({ kind: 'choose', mode: 'borrow' }),
      );
      borrow.dataset.mode = 'borrow';
      const repay = button(t('action.repay'), 'primary', () =>
        onKey({ kind: 'choose', mode: 'repay' }),
      );
      repay.dataset.mode = 'repay';
      // No loan: the original does not react; nothing to pay with: not offered here.
      repay.disabled = offer.repayMax === null;
      menu.append(
        borrow,
        repay,
        button(t('action.leaveCounter'), 'secondary', () => onAct({ type: 'leaveCounter' })),
      );
      this.body.replaceChildren(menu);
    } else {
      const keypad = el('div', 'bank-keypad');
      for (const digit of [7, 8, 9, 4, 5, 6, 1, 2, 3, 0]) {
        keypad.append(button(String(digit), 'bank-key', () => onKey({ kind: 'digit', digit })));
      }
      keypad.append(
        button(t('bank.key.clear'), 'bank-key', () => onKey({ kind: 'clear' })),
        button(t('bank.key.fill'), 'bank-key', () => onKey({ kind: 'fill' })),
        button(t('bank.key.back'), 'bank-key', () => onKey({ kind: 'back' })),
      );
      const actions = el('div', 'bank-actions');
      actions.append(
        button(t('bank.confirm'), 'primary', onConfirm),
        button(t('bank.cancel'), 'secondary', () => onKey({ kind: 'cancel' })),
      );
      this.body.replaceChildren(
        el('h3', undefined, t(`action.${entry.mode}`)),
        this.amount,
        this.limit,
        keypad,
        this.slider,
        actions,
      );
    }
    this.root.replaceChildren(this.title, this.balances, this.notice, this.body);
  }
}
