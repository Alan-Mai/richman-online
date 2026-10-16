// @vitest-environment happy-dom
import type { GameEvent } from '@richman/shared';
import { describe, expect, it } from 'vitest';
import type { DisplayModel } from '../model/display';
import { GameOverDialog } from './game-over';

const model: DisplayModel = {
  round: 20,
  day: 19,
  date: { year: 2010, month: 1, day: 20 },
  priceIndex: 1,
  current: 'p4',
  players: ['甲', '乙', '丙', '丁'].map((name, i) => ({
    id: `p${i + 1}`,
    name,
    cash: 0,
    deposit: 0,
    loan: 0,
    loanDue: null,
    tile: 0,
    vehicle: 'walk' as const,
    diceCount: 1,
    bankrupt: i === 3,
  })),
  tiles: [],
  auction: null,
  winners: null,
};

const ended: GameEvent = {
  type: 'GameEnded',
  reason: 'dayLimitOrNetWorthTarget',
  winners: ['p2'],
  netWorth: { p1: 30000, p2: 52000, p3: 52000, p4: 0 },
};

function open(event: GameEvent = ended) {
  const root = document.createElement('div');
  root.hidden = true;
  let again = 0;
  const dialog = new GameOverDialog(root, { seed: 77, onAgain: () => again++ });
  dialog.eventPlayed(event, model);
  return { root, again: () => again };
}

/** The dialog's paragraphs in order (the title is a heading, not included). */
const lines = (root: HTMLElement) => [...root.querySelectorAll('p')].map((p) => p.textContent);

describe('GameOverDialog', () => {
  it('ignores other events', () => {
    const { root } = open({ type: 'TurnStarted', playerId: 'p1', round: 1 });
    expect(root.hidden).toBe(true);
    expect(root.children).toHaveLength(0);
  });

  it('shows only the reason, the winner and the seed for a day limit or net worth ending', () => {
    const { root } = open();
    expect(root.hidden).toBe(false);
    expect(lines(root)).toEqual(['遊戲結束：已達天數上限或淨值目標', '勝利：乙', '本局種子：77']);
    expect(root.querySelector('ol, ul')).toBeNull();
  });

  it('shows only the reason, the winner and the seed for a last-standing ending', () => {
    const { root } = open({ ...ended, reason: 'lastStanding', winners: ['p3'] });
    expect(lines(root)).toEqual(['遊戲結束：只剩一位玩家', '勝利：丙', '本局種子：77']);
    expect(root.querySelector('ol, ul')).toBeNull();
  });

  it('says when nobody won', () => {
    const { root } = open({ ...ended, reason: 'lastStanding', winners: [] });
    expect(root.querySelector('.game-over-winners')?.textContent).toBe('沒有勝利者');
  });

  it('shows no winner when the only human seat went bankrupt', () => {
    const { root } = open({ ...ended, reason: 'humanBankrupt', winners: [] });
    expect(lines(root)).toEqual(['遊戲結束：唯一的人類玩家破產了', '沒有勝利者', '本局種子：77']);
  });

  it('goes straight back to setup when no human is left, without a dialog', () => {
    const { root, again } = open({ ...ended, reason: 'noHumansLeft', winners: [] });
    expect(again()).toBe(1);
    expect(root.hidden).toBe(true);
    expect(root.children).toHaveLength(0);
  });

  it('goes back to setup on request', () => {
    const { root, again } = open();
    root.querySelector('button')!.click();
    expect(again()).toBe(1);
  });
});
