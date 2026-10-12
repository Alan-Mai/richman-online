import { describe, expect, it } from 'vitest';
import type { GameRecord, GameSpec, Outcome } from './game';
import {
  failureKeys,
  formatActions,
  formatFailureDetail,
  formatStats,
  rerunCommand,
  summarize,
} from './stats';

function record(seed: number, outcome: Outcome, rounds: number, steps = 10, bankruptcies = 0) {
  const actions = Array.from({ length: steps }, () => ({
    type: 'rollDice' as const,
    playerId: 'p1',
  }));
  return { seed, actions, rounds, bankruptcies, outcome } satisfies GameRecord;
}

const finished = (reason: 'lastStanding' | 'roundLimit', winnerSeats: number[]): Outcome => ({
  kind: 'finished',
  reason,
  winnerSeats,
});

const RECORDS: GameRecord[] = [
  record(1, finished('roundLimit', [0]), 100, 400, 1),
  record(2, finished('roundLimit', [1, 2]), 100, 400),
  record(3, finished('lastStanding', [3]), 40, 150, 3),
  record(4, finished('lastStanding', []), 30, 50, 4),
  record(5, { kind: 'unfinished' }, 500, 1000, 2),
  record(
    11,
    {
      kind: 'failed',
      step: 3,
      failure: {
        kind: 'invariant',
        violations: [
          'player p1: cash -1 is not a non-negative integer',
          'tile 3: unowned but level 2',
        ],
      },
    },
    1,
    3,
  ),
  record(
    12,
    {
      kind: 'failed',
      step: 8,
      failure: {
        kind: 'invariant',
        violations: ['player p2: cash -70 is not a non-negative integer'],
      },
    },
    2,
    8,
  ),
  record(
    13,
    { kind: 'failed', step: 0, failure: { kind: 'exception', message: 'index 5 out of range' } },
    1,
    0,
  ),
];

describe('summarize', () => {
  const stats = summarize(RECORDS, 4);

  it('counts games by outcome and end reason', () => {
    expect(stats).toMatchObject({
      games: 8,
      finished: 4,
      unfinished: 1,
      failed: 3,
      reasons: { roundLimit: 2, lastStanding: 2, noWinner: 1 },
      bankruptcies: 10,
      tiedGames: 1,
    });
  });

  it('averages rounds over finished games and steps over games that did not fail', () => {
    expect(stats.rounds).toEqual({ mean: 67.5, min: 30, max: 100 });
    expect(stats.meanSteps).toBe(400);
  });

  it('splits tied wins 1/k per seat', () => {
    expect(stats.seatWins).toEqual([1, 0.5, 0.5, 1]);
  });

  it('groups failures by normalized reason with one example seed each', () => {
    expect(stats.failureGroups).toEqual([
      { key: 'invariant: player p#: cash # is not a non-negative integer', count: 2, seed: 11 },
      { key: 'invariant: tile #: unowned but level #', count: 1, seed: 11 },
      { key: 'exception: index # out of range', count: 1, seed: 13 },
    ]);
  });

  it('handles a run without finished games', () => {
    const empty = summarize([record(5, { kind: 'unfinished' }, 9)], 4);
    expect(empty.rounds).toBeNull();
    expect(empty.seatWins).toEqual([0, 0, 0, 0]);
  });
});

describe('failureKeys', () => {
  it('names each failure kind', () => {
    const action = { type: 'buyProperty' as const, playerId: 'p3' };
    expect(failureKeys({ kind: 'noLegalActions', playerId: 'p2' })).toEqual(['noLegalActions']);
    expect(failureKeys({ kind: 'offeredOutOfTurn', playerId: 'p2', actions: [action] })).toEqual([
      'offeredOutOfTurn: buyProperty',
    ]);
    expect(
      failureKeys({ kind: 'legalActionRejected', action, error: { code: 'insufficientFunds' } }),
    ).toEqual(['legalActionRejected: buyProperty -> insufficientFunds']);
    expect(failureKeys({ kind: 'unofferedNotRefused', action, outcome: 'accepted' })).toEqual([
      'unofferedNotRefused: buyProperty -> accepted',
    ]);
    expect(failureKeys({ kind: 'stepLimit', maxSteps: 9 })).toEqual(['stepLimit']);
    expect(failureKeys({ kind: 'missingGameEnded' })).toEqual(['missingGameEnded']);
    expect(failureKeys({ kind: 'createGame', errors: [{ reason: 'invalidSeed' }] })).toEqual([
      'createGame: invalidSeed',
    ]);
    expect(failureKeys({ kind: 'notOffered', action })).toEqual(['notOffered: buyProperty']);
  });

  it('counts a repeated violation once per game', () => {
    expect(
      failureKeys({
        kind: 'invariant',
        violations: ['tile 1: unowned but level 2', 'tile 4: unowned but level 1'],
      }),
    ).toEqual(['invariant: tile #: unowned but level #']);
  });
});

describe('formatting', () => {
  const spec: GameSpec = { seed: 12, win: 'richestAtRoundLimit', maxRounds: 100, maxSteps: 10_000 };

  it('formats actions compactly', () => {
    expect(
      formatActions([
        { type: 'rollDice', playerId: 'p1' },
        { type: 'decline', playerId: 'p1' },
      ]),
    ).toBe('p1:rollDice p1:decline');
  });

  it('builds a rerun command for one game', () => {
    expect(rerunCommand(spec)).toBe(
      'pnpm -F sim sim -- --games 1 --seed 12 --win richestAtRoundLimit --max-rounds 100 --max-steps 10000',
    );
    expect(rerunCommand({ ...spec, win: 'lastStanding', maxRounds: null })).toBe(
      'pnpm -F sim sim -- --games 1 --seed 12 --win lastStanding --max-steps 10000',
    );
  });

  it('prints a failure with its seeds, actions and both commands', () => {
    const failed = RECORDS[6] as GameRecord;
    const text = formatFailureDetail(11, 1, failed, spec, 'tools/sim/out/failure-12.json');
    expect(text).toContain('game #11 (run seed 1), game seed 12, failed at step 8');
    expect(text).toContain('player p2: cash -70 is not a non-negative integer');
    expect(text).toContain(`actions (8): ${formatActions(failed.actions)}`);
    expect(text).toContain(rerunCommand(spec));
    expect(text).toContain('pnpm -F sim sim -- replay tools/sim/out/failure-12.json');
  });

  it('prints the summary', () => {
    const text = formatStats(summarize(RECORDS, 4), 2500);
    expect(text).toContain('games: 8 (finished 4, unfinished 1, failed 3)');
    expect(text).toContain('rounds (finished games): mean 67.5, min 30, max 100');
    expect(text).toContain('roundLimit 2 (25.0%)');
    expect(text).toContain('lastStanding 2 (25.0%, 1 without a winner)');
    expect(text).toContain('seat 1 25.0%');
    expect(text).toContain('seat 2 12.5%');
    expect(text).toContain('tied games: 1');
    expect(text).toContain('2x invariant: player p#: cash # is not a non-negative integer');
    expect(text).toContain('elapsed: 2.5s');
  });
});
