// The dice count control of the original HUD (docs/GAME_RULES.md section 9): one button per die
// up to the vehicle's most, the first `count` of them lit. Shown only on a human's own turn before
// rolling; clicking a button sets that many dice, and the D key cycles 1 → 2 (→ 3) → 1. On foot
// there is a single lit button and no choice.
import type { RuleConfig, ServerUpdate } from '@richman/shared';
import { t } from '../i18n';
import type { Intent } from '../net/connection';

export interface DicePanelState {
  /** The vehicle's most dice: one button each. */
  most: number;
  /** Dice the next roll uses; buttons 1..count are lit. */
  count: number;
  /** Counts that may be chosen now; empty on foot. */
  choices: readonly number[];
}

/** The panel for the ready update, or null when the player is not about to roll. */
export function dicePanelState(update: ServerUpdate, config: RuleConfig): DicePanelState | null {
  const { legalActions, view } = update;
  if (!legalActions.some((a) => a.type === 'rollDice')) return null;
  const player = view.players.find((p) => p.id === view.turn.current);
  if (player === undefined) return null;
  const choices = legalActions.flatMap((a) => (a.type === 'setDiceCount' ? [a.count] : []));
  return { most: config.vehicleMaxDice[player.vehicle], count: player.diceCount, choices };
}

/** The D key: the next count after the current one, back to the smallest after the most. */
export function cycleDiceIntent(state: DicePanelState | null): Intent | null {
  if (state === null || state.choices.length === 0) return null;
  const sorted = [...state.choices].sort((a, b) => a - b);
  const next = sorted.find((c) => c > state.count) ?? sorted[0];
  return next === undefined ? null : { type: 'setDiceCount', count: next };
}

export function renderDicePanel(
  root: HTMLElement,
  state: DicePanelState | null,
  onAct: (intent: Intent) => void,
): void {
  root.hidden = state === null;
  if (state === null) {
    root.replaceChildren();
    return;
  }
  const title = document.createElement('span');
  title.className = 'hud-dice-title';
  title.textContent = t('hud.dice');
  const buttons = Array.from({ length: state.most }, (_, i) => {
    const count = i + 1;
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = String(count);
    button.setAttribute('aria-label', t('hud.dice.count', { count }));
    button.setAttribute('aria-pressed', String(count === state.count));
    if (count <= state.count) button.classList.add('is-lit');
    button.disabled = !state.choices.includes(count);
    button.addEventListener('click', () => onAct({ type: 'setDiceCount', count }));
    return button;
  });
  root.replaceChildren(title, ...buttons);
}
