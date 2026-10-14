// @vitest-environment happy-dom
import type { GameEvent, ServerUpdate } from '@richman/shared';
import { describe, expect, it } from 'vitest';
import type { DisplayModel } from '../model/display';
import { hotSeatSetup, playRandomGame } from '../testing/random-game';
import { GameOverDialog } from './game-over';

const model: DisplayModel = {
  round: 20,
  day: 19,
  priceIndex: 1,
  current: 'p4',
  players: ['甲', '乙', '丙', '丁'].map((name, i) => ({
    id: `p${i + 1}`,
    name,
    cash: 0,
    deposit: 0,
    tile: 0,
    bankrupt: i === 3,
  })),
  tiles: [],
  winners: null,
};

const ended: GameEvent = {
  type: 'GameEnded',
  reason: 'dayLimitOrNetWorthTarget',
  winners: ['p2'],
  netWorth: { p1: 30000, p2: 52000, p3: 52000, p4: 0 },
};

/** Stands in for the update an event arrived in; only its identity matters to the dialog. */
const sample = playRandomGame(hotSeatSetup(1))[0]!;
function update(): ServerUpdate {
  return { ...sample };
}

function bankrupt(playerId: string): GameEvent {
  return {
    type: 'PlayerBankrupt',
    playerId,
    creditor: null,
    paidToCreditor: 0,
    releasedTiles: [],
    cause: { kind: 'system', amountDue: 1 },
  };
}

/** Plays each group of events as one update, then opens with the last event. */
function open(event: GameEvent = ended, before: GameEvent[][] = []) {
  const root = document.createElement('div');
  root.hidden = true;
  let again = 0;
  const dialog = new GameOverDialog(root, { seed: 77, onAgain: () => again++ });
  for (const group of before) {
    const u = update();
    for (const e of group) dialog.eventPlayed(e, model, u);
  }
  dialog.eventPlayed(event, model, update());
  return { root, again: () => again };
}

describe('GameOverDialog', () => {
  it('ignores other events', () => {
    const { root } = open({ type: 'TurnStarted', playerId: 'p1', round: 1 });
    expect(root.hidden).toBe(true);
    expect(root.children).toHaveLength(0);
  });

  it('shows only the reason, the winner and the seed for a day limit or net worth ending', () => {
    const { root } = open();
    expect(root.hidden).toBe(false);
    expect(root.textContent).toContain('遊戲結束：已達天數上限或淨值目標');
    expect(root.querySelector('.game-over-winners')?.textContent).toBe('勝利：乙');
    // The original shows no ranking for this ending.
    expect(root.querySelector('.game-over-ranking')).toBeNull();
    expect(root.querySelector('.game-over-seed')?.textContent).toBe('本局種子：77');
  });

  it('ranks a last-standing game by bankruptcy order, ties within one action', () => {
    const lastStanding: GameEvent = {
      type: 'GameEnded',
      reason: 'lastStanding',
      winners: ['p3'],
      netWorth: { p1: 0, p2: 0, p3: 1000, p4: 0 },
    };
    // p4 first, then p1 and p2 in the same action.
    const { root } = open(lastStanding, [[bankrupt('p4')], [bankrupt('p1'), bankrupt('p2')]]);
    const rows = [...root.querySelectorAll('.game-over-ranking li')].map((li) => li.textContent);
    expect(rows).toEqual(['第 1 名 丙存活', '第 2 名 甲破產', '第 2 名 乙破產', '第 4 名 丁破產']);
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
