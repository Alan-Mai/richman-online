import type { GameEvent } from '@richman/shared';
import { describe, expect, it } from 'vitest';
import { rankPlayers } from './ranking';

type GameEnded = Extract<GameEvent, { type: 'GameEnded' }>;

const seats = ['p1', 'p2', 'p3', 'p4'];

function ended(reason: GameEnded['reason'], totals: number[], winners: string[] = []): GameEnded {
  return {
    type: 'GameEnded',
    reason,
    winners,
    netWorth: Object.fromEntries(seats.map((id, i) => [id, totals[i] ?? 0])),
  };
}

const ranks = (r: ReturnType<typeof rankPlayers>) => r.map((p) => `${p.id}:${p.rank}`);

describe('rankPlayers, day limit or net worth target', () => {
  it('orders by net worth, equal amounts by seat without sharing ranks', () => {
    const totals = [30000, 52000, 52000, 0];
    for (const reason of ['dayLimit', 'netWorthTarget'] as const) {
      const result = rankPlayers(seats, ended(reason, totals, ['p2']), [['p4']]);
      expect(ranks(result)).toEqual(['p2:1', 'p3:2', 'p1:3', 'p4:4']);
      expect(result.find((p) => p.id === 'p4')?.bankrupt).toBe(true);
      expect(result.find((p) => p.id === 'p3')?.netWorth).toBe(52000);
    }
  });
});

describe('rankPlayers, last standing', () => {
  it('puts the survivor first and later bankruptcies ahead of earlier ones', () => {
    // p3 went bankrupt first, then p1, then p4; p2 survived.
    const result = rankPlayers(seats, ended('lastStanding', [0, 90000, 0, 0], ['p2']), [
      ['p3'],
      ['p1'],
      ['p4'],
    ]);
    expect(ranks(result)).toEqual(['p2:1', 'p4:2', 'p1:3', 'p3:4']);
  });

  it('ties players who went bankrupt in the same action', () => {
    const result = rankPlayers(seats, ended('lastStanding', [0, 0, 5000, 0], ['p3']), [
      ['p1'],
      ['p2', 'p4'],
    ]);
    expect(ranks(result)).toEqual(['p3:1', 'p2:2', 'p4:2', 'p1:4']);
  });

  it('ignores total assets', () => {
    const result = rankPlayers(seats, ended('lastStanding', [100, 0, 0, 0], ['p2']), [
      ['p1', 'p3', 'p4'],
    ]);
    expect(ranks(result)).toEqual(['p2:1', 'p1:2', 'p3:2', 'p4:2']);
  });

  it('ranks the last group first when nobody survives', () => {
    const result = rankPlayers(seats, ended('lastStanding', [0, 0, 0, 0]), [
      ['p1', 'p2'],
      ['p3', 'p4'],
    ]);
    expect(ranks(result)).toEqual(['p3:1', 'p4:1', 'p1:3', 'p2:3']);
  });
});
