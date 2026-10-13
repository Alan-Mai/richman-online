// @vitest-environment happy-dom
import type { GameEvent } from '@richman/shared';
import { describe, expect, it } from 'vitest';
import type { DisplayModel } from '../model/display';
import { GameOverDialog } from './game-over';

const model: DisplayModel = {
  round: 20,
  current: 'p4',
  players: ['甲', '乙', '丙', '丁'].map((name, i) => ({
    id: `p${i + 1}`,
    name,
    cash: 0,
    deposit: 0,
    position: 0,
    bankrupt: i === 3,
  })),
  tiles: [],
  winners: null,
};

const ended: GameEvent = {
  type: 'GameEnded',
  reason: 'roundLimit',
  winners: ['p2', 'p3'],
  totalAssets: { p1: 30000, p2: 52000, p3: 52000, p4: 0 },
};

function open(event: GameEvent = ended) {
  const root = document.createElement('div');
  root.hidden = true;
  let again = 0;
  const dialog = new GameOverDialog(root, { seed: 77, onAgain: () => again++ });
  dialog.eventPlayed(event, model);
  return { root, again: () => again };
}

describe('GameOverDialog', () => {
  it('ignores other events', () => {
    const { root } = open({ type: 'TurnStarted', playerId: 'p1', round: 1 });
    expect(root.hidden).toBe(true);
    expect(root.children).toHaveLength(0);
  });

  it('shows winners, a ranking by total assets with shared ranks, and the seed', () => {
    const { root } = open();
    expect(root.hidden).toBe(false);
    expect(root.querySelector('.game-over-winners')?.textContent).toBe('勝利：乙、丙');
    const rows = [...root.querySelectorAll('.game-over-ranking li')].map((li) => li.textContent);
    expect(rows).toEqual([
      '第 1 名 乙總資產 52,000',
      '第 1 名 丙總資產 52,000',
      '第 3 名 甲總資產 30,000',
      '第 4 名 丁總資產 0',
    ]);
    expect(root.querySelectorAll('.is-winner')).toHaveLength(2);
    expect(root.querySelector('.game-over-seed')?.textContent).toBe('本局種子：77');
  });

  it('says when nobody won', () => {
    const { root } = open({ ...ended, reason: 'lastStanding', winners: [] });
    expect(root.querySelector('.game-over-winners')?.textContent).toBe('沒有勝利者');
  });

  it('goes back to setup on request', () => {
    const { root, again } = open();
    root.querySelector('button')!.click();
    expect(again()).toBe(1);
  });
});
