// @vitest-environment happy-dom
import { DEFAULT_RULE_CONFIG, type ServerUpdate, type Vehicle } from '@richman/shared';
import { describe, expect, it } from 'vitest';
import type { Intent } from '../net/connection';
import { createHost, hotSeatSetup } from '../testing/random-game';
import { cycleDiceIntent, dicePanelState, renderDicePanel } from './dice-panel';

const CONFIG = DEFAULT_RULE_CONFIG;

/** The opening update of a hot-seat game where everyone starts on `vehicle`. */
function opening(vehicle: Vehicle): ServerUpdate {
  const setup = hotSeatSetup(5);
  const host = createHost({ ...setup, config: { ...setup.config, startingVehicle: vehicle } });
  const updates: ServerUpdate[] = [];
  host.subscribe((m) => {
    if (m.kind === 'update') updates.push(m.update);
  });
  host.start();
  const first = updates[0];
  if (first === undefined) throw new Error('no opening update');
  return first;
}

/** The same update with the current player's dice count changed. */
function withCount(update: ServerUpdate, diceCount: number): ServerUpdate {
  const players = update.view.players.map((p) =>
    p.id === update.view.turn.current ? { ...p, diceCount } : p,
  );
  return { ...update, view: { ...update.view, players } };
}

describe('dicePanelState', () => {
  it('offers every count up to the vehicle limit before rolling', () => {
    expect(dicePanelState(opening('car'), CONFIG)).toEqual({
      most: 3,
      count: 3,
      choices: [1, 2, 3],
    });
    expect(dicePanelState(opening('motorbike'), CONFIG)).toEqual({
      most: 2,
      count: 2,
      choices: [1, 2],
    });
  });

  it('shows a single die without a choice on foot', () => {
    expect(dicePanelState(opening('walk'), CONFIG)).toEqual({ most: 1, count: 1, choices: [] });
  });

  it('is hidden unless the player is about to roll', () => {
    const update = opening('car');
    expect(dicePanelState({ ...update, legalActions: [] }, CONFIG)).toBeNull();
  });
});

describe('cycleDiceIntent', () => {
  it('cycles 1 → 2 → 3 → 1 on a car and 1 ↔ 2 on a motorbike', () => {
    const car = opening('car');
    const next = (update: ServerUpdate, count: number) =>
      cycleDiceIntent(dicePanelState(withCount(update, count), CONFIG));
    expect(next(car, 1)).toEqual({ type: 'setDiceCount', count: 2 });
    expect(next(car, 2)).toEqual({ type: 'setDiceCount', count: 3 });
    expect(next(car, 3)).toEqual({ type: 'setDiceCount', count: 1 });
    const bike = opening('motorbike');
    expect(next(bike, 1)).toEqual({ type: 'setDiceCount', count: 2 });
    expect(next(bike, 2)).toEqual({ type: 'setDiceCount', count: 1 });
  });

  it('does nothing on foot or when not about to roll', () => {
    expect(cycleDiceIntent(dicePanelState(opening('walk'), CONFIG))).toBeNull();
    expect(cycleDiceIntent(null)).toBeNull();
  });
});

describe('renderDicePanel', () => {
  function render(update: ServerUpdate) {
    const root = document.createElement('div');
    const acted: Intent[] = [];
    renderDicePanel(root, dicePanelState(update, CONFIG), (intent) => acted.push(intent));
    const buttons = [...root.querySelectorAll('button')];
    return { root, acted, buttons };
  }

  it('lights the first count buttons and sets the clicked count', () => {
    const { buttons, acted } = render(withCount(opening('car'), 2));
    expect(buttons.map((b) => b.textContent)).toEqual(['1', '2', '3']);
    expect(buttons.map((b) => b.classList.contains('is-lit'))).toEqual([true, true, false]);
    expect(buttons.map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'true', 'false']);
    buttons[2]?.click();
    buttons[0]?.click();
    expect(acted).toEqual([
      { type: 'setDiceCount', count: 3 },
      { type: 'setDiceCount', count: 1 },
    ]);
  });

  it('shows one lit, disabled button on foot', () => {
    const { buttons } = render(opening('walk'));
    expect(buttons).toHaveLength(1);
    expect(buttons[0]?.classList.contains('is-lit')).toBe(true);
    expect(buttons[0]?.disabled).toBe(true);
  });

  it('hides itself when not about to roll', () => {
    const update = opening('car');
    const { root, buttons } = render({ ...update, legalActions: [] });
    expect(root.hidden).toBe(true);
    expect(buttons).toHaveLength(0);
  });
});
