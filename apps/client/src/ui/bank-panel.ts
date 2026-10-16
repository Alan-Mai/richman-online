// The bank's deposit and withdrawal dialog (docs/GAME_RULES.md §4) as a HUD section. Like the
// original: two modes (withdraw up to the deposit, deposit up to the cash), a number of up to 9
// digits typed on a keypad (capped at the limit), clear, fill to the limit, backspace, a 34-step
// slider that also shows the amount, and confirm or cancel. One transfer per visit; confirming 0
// moves nothing.
import type { BankDirection, ServerUpdate, TileIndex } from '@richman/shared';
import { formatMoney, t } from '../i18n';
import type { Intent } from '../net/connection';

/** The original's limits on the amount field and its slider. */
export const BANK_MAX_DIGITS = 9;
export const BANK_SLIDER_STEPS = 34;

/** What the bank offers now: each mode's limit, null when that mode is not offered. */
export interface BankOffer {
  tile: TileIndex;
  trigger: 'pass' | 'land';
  max: Readonly<Record<BankDirection, number | null>>;
}

/** The dialog's own state: the mode and the digits typed ("0" when empty). */
export interface BankEntry {
  mode: BankDirection;
  digits: string;
}

export type BankKey =
  | { kind: 'digit'; digit: number }
  | { kind: 'clear' }
  | { kind: 'fill' }
  | { kind: 'back' }
  | { kind: 'slider'; step: number }
  | { kind: 'mode'; mode: BankDirection };

/** The bank of the ready update, or null when no bank is open for this player. */
export function bankOffer(update: ServerUpdate | null): BankOffer | null {
  const phase = update?.view.turn.phase;
  if (update === null || phase?.kind !== 'bank') return null;
  if (!update.legalActions.some((a) => a.type === 'leaveBank')) return null;
  const maxOf = (direction: BankDirection) => {
    const option = update.legalActions.find(
      (a) => a.type === 'bankTransfer' && a.direction === direction,
    );
    return option?.type === 'bankTransfer' ? option.max : null;
  };
  return {
    tile: phase.tile,
    trigger: phase.trigger.kind,
    max: { withdraw: maxOf('withdraw'), deposit: maxOf('deposit') },
  };
}

/** Opens on withdrawing, like the original, unless only depositing is offered. */
export function initialBankEntry(offer: BankOffer): BankEntry {
  const mode = offer.max.withdraw === null && offer.max.deposit !== null ? 'deposit' : 'withdraw';
  return { mode, digits: '0' };
}

export function bankAmount(entry: BankEntry): number {
  return Number(entry.digits);
}

/**
 * Where the slider shows an amount, like the original after every change of the amount: filled
 * to trunc(amount ÷ limit × 34) steps, so an amount between steps shows the step below. Divided
 * and multiplied in double precision like the original's FPU (53-bit precision control). A limit
 * of 0 is undefined in the original; it only comes with no mode offered here, and shows step 0.
 */
export function sliderStep(amount: number, max: number): number {
  return max <= 0 ? 0 : Math.trunc((amount / max) * BANK_SLIDER_STEPS);
}

/** The original's slider: step k is k × (⌊limit ÷ 34⌋ + 1), capped; the ends are 0 and the limit. */
export function sliderAmount(step: number, max: number): number {
  if (step <= 0) return 0;
  if (step >= BANK_SLIDER_STEPS) return max;
  return Math.min(max, step * (Math.floor(max / BANK_SLIDER_STEPS) + 1));
}

export function pressBankKey(entry: BankEntry, key: BankKey, offer: BankOffer): BankEntry {
  const max = offer.max[entry.mode] ?? 0;
  switch (key.kind) {
    case 'digit': {
      if (entry.digits !== '0' && entry.digits.length >= BANK_MAX_DIGITS) return entry;
      const typed = entry.digits === '0' ? String(key.digit) : entry.digits + String(key.digit);
      return { ...entry, digits: String(Math.min(Number(typed), max)) };
    }
    case 'clear':
      return { ...entry, digits: '0' };
    case 'fill':
      return { ...entry, digits: String(max) };
    case 'back':
      return { ...entry, digits: entry.digits.length > 1 ? entry.digits.slice(0, -1) : '0' };
    case 'slider':
      return { ...entry, digits: String(sliderAmount(key.step, max)) };
    case 'mode':
      // Switching modes starts again from 0, like the original.
      return offer.max[key.mode] === null ? entry : { mode: key.mode, digits: '0' };
  }
}

/** Confirming: the transfer, or leaving the bank when the amount is 0. */
export function confirmIntent(entry: BankEntry): Intent {
  const amount = bankAmount(entry);
  return amount === 0
    ? { type: 'leaveBank' }
    : { type: 'bankTransfer', direction: entry.mode, amount };
}

/** What a physical key does while the dialog is open: a dialog key, confirm, cancel, or nothing. */
export function bankKeyFor(key: string): BankKey | 'confirm' | 'cancel' | null {
  if (/^[0-9]$/.test(key)) return { kind: 'digit', digit: Number(key) };
  switch (key) {
    case 'Backspace':
      return { kind: 'back' };
    case 'Enter':
      return 'confirm';
    case 'Escape':
      return 'cancel';
    default:
      return null;
  }
}

export interface BankPanelView {
  offer: BankOffer;
  entry: BankEntry;
  tileName: string;
  cash: number;
  deposit: number;
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

/**
 * Builds the dialog once per opening and updates it in place afterwards, so the slider keeps
 * working while it is dragged.
 */
export class BankPanel {
  private shown: BankOffer | null = null;
  private readonly title = el('h2');
  private readonly cash = el('dd', 'bank-cash');
  private readonly deposit = el('dd', 'bank-deposit');
  private readonly modes = (['withdraw', 'deposit'] as const).map((mode) => {
    const choice = button(t(`bank.mode.${mode}`), 'bank-mode', () =>
      this.handlers.onKey({ kind: 'mode', mode }),
    );
    choice.dataset.mode = mode;
    return { mode, choice };
  });
  private readonly amount = el('output', 'bank-amount');
  private readonly limit = el('p', 'bank-limit');
  private readonly slider = el('input', 'bank-slider');
  private entry: BankEntry | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly handlers: { onKey: (key: BankKey) => void; onAct: (intent: Intent) => void },
  ) {
    root.hidden = true;
    this.amount.setAttribute('aria-live', 'polite');
    this.slider.type = 'range';
    this.slider.min = '0';
    this.slider.max = String(BANK_SLIDER_STEPS);
    this.slider.step = '1';
    this.slider.setAttribute('aria-label', t('bank.slider'));
    this.slider.addEventListener('input', () =>
      handlers.onKey({ kind: 'slider', step: Number(this.slider.value) }),
    );
  }

  render(view: BankPanelView | null): void {
    if (view === null) {
      this.shown = null;
      this.entry = null;
      this.root.hidden = true;
      this.root.replaceChildren();
      return;
    }
    if (this.shown !== view.offer) {
      this.shown = view.offer;
      this.build();
    }
    const { offer, entry } = view;
    this.entry = entry;
    this.title.textContent = t(offer.trigger === 'pass' ? 'bank.title.pass' : 'bank.title.land', {
      tile: view.tileName,
    });
    this.cash.textContent = formatMoney(view.cash);
    this.deposit.textContent = formatMoney(view.deposit);
    for (const { mode, choice } of this.modes) {
      choice.setAttribute('aria-pressed', String(entry.mode === mode));
      choice.disabled = offer.max[mode] === null;
    }
    this.amount.textContent = formatMoney(bankAmount(entry));
    const max = offer.max[entry.mode] ?? 0;
    this.limit.textContent = t('bank.limit', { max: formatMoney(max) });
    const step = String(sliderStep(bankAmount(entry), max));
    if (this.slider.value !== step) this.slider.value = step;
    this.slider.disabled = offer.max[entry.mode] === null;
    this.root.hidden = false;
  }

  private build(): void {
    const { onKey, onAct } = this.handlers;
    const balances = el('dl', 'bank-balances');
    balances.append(
      el('dt', undefined, t('hud.cash')),
      this.cash,
      el('dt', undefined, t('hud.deposit')),
      this.deposit,
    );
    const modes = el('div', 'bank-modes');
    modes.append(...this.modes.map(({ choice }) => choice));
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
      button(t('bank.confirm'), 'primary', () => {
        if (this.entry !== null) onAct(confirmIntent(this.entry));
      }),
      button(t('bank.cancel'), 'secondary', () => onAct({ type: 'leaveBank' })),
    );
    this.root.replaceChildren(
      this.title,
      balances,
      modes,
      this.amount,
      this.limit,
      keypad,
      this.slider,
      actions,
    );
  }
}
