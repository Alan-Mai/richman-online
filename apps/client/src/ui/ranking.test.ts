import { describe, expect, it } from 'vitest';
import { rankPlayers } from './ranking';

const seats = ['p1', 'p2', 'p3', 'p4'];

const ranks = (r: ReturnType<typeof rankPlayers>) => r.map((p) => `${p.id}:${p.rank}`);

describe('rankPlayers (last standing)', () => {
  it('puts the survivor first and later bankruptcies ahead of earlier ones', () => {
    // p3 went bankrupt first, then p1, then p4; p2 survived.
    const result = rankPlayers(seats, [['p3'], ['p1'], ['p4']]);
    expect(ranks(result)).toEqual(['p2:1', 'p4:2', 'p1:3', 'p3:4']);
    expect(result.find((p) => p.id === 'p4')?.bankrupt).toBe(true);
    expect(result.find((p) => p.id === 'p2')?.bankrupt).toBe(false);
  });

  it('ties players who went bankrupt in the same action', () => {
    const result = rankPlayers(seats, [['p1'], ['p2', 'p4']]);
    expect(ranks(result)).toEqual(['p3:1', 'p2:2', 'p4:2', 'p1:4']);
  });

  it('ranks the last group first when nobody survives', () => {
    const result = rankPlayers(seats, [
      ['p1', 'p2'],
      ['p3', 'p4'],
    ]);
    expect(ranks(result)).toEqual(['p3:1', 'p4:1', 'p1:3', 'p2:3']);
  });
});
