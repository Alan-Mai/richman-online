import { describe, expect, it } from 'vitest';
import {
  emptyMetrics,
  type EndReason,
  type GameMetrics,
  type GameRecord,
  type GameSpec,
  type Outcome,
} from './game';
import {
  describeFailure,
  failureKeys,
  formatActions,
  formatFailureDetail,
  formatStats,
  rerunCommand,
  summarize,
} from './stats';

function record(
  seed: number,
  outcome: Outcome,
  rounds: number,
  steps = 10,
  bankruptcies = 0,
  metrics: Partial<GameMetrics> = {},
) {
  const actions = Array.from({ length: steps }, () => ({
    type: 'rollDice' as const,
    playerId: 'p1',
  }));
  return {
    seed,
    actions,
    rounds,
    bankruptcies,
    metrics: { ...emptyMetrics(), ...metrics },
    outcome,
  } satisfies GameRecord;
}

const finished = (reason: EndReason, winnerSeats: number[]): Outcome => ({
  kind: 'finished',
  reason,
  winnerSeats,
});

const RECORDS: GameRecord[] = [
  record(1, finished('dayLimitOrNetWorthTarget', [0]), 100, 400, 1),
  record(2, finished('dayLimitOrNetWorthTarget', [1, 2]), 100, 400),
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
          'tile 3: level 7 is outside 0..5',
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
      reasons: {
        lastStanding: 2,
        dayLimitOrNetWorthTarget: 2,
        humanBankrupt: 0,
        noHumansLeft: 0,
        noWinner: 1,
      },
      bankruptcies: 10,
      tiedGames: 1,
    });
  });

  it('averages rounds over finished games and steps over games that did not fail', () => {
    expect(stats.rounds).toEqual({ mean: 67.5, median: 40, p90: 100, min: 30, max: 100 });
    expect(stats.meanSteps).toBe(400);
  });

  it('splits tied wins 1/k per seat', () => {
    expect(stats.seatWins).toEqual([1, 0.5, 0.5, 1]);
  });

  it('groups failures by normalized reason with one example seed each', () => {
    expect(stats.failureGroups).toEqual([
      { key: 'invariant: player p#: cash # is not a non-negative integer', count: 2, seed: 11 },
      { key: 'invariant: tile #: level # is outside #..#', count: 1, seed: 11 },
      { key: 'exception: index # out of range', count: 1, seed: 13 },
    ]);
  });

  it('summarizes bankruptcies, days, the price index, auctions, the lottery pool and moves', () => {
    const games = [
      record(1, finished('lastStanding', [0]), 50, 10, 2, {
        firstBankruptcyRound: 10,
        finalDay: 49,
        finalPriceIndex: 3,
        priceIndexRiseRound: 20,
        lotteryPool: 9000,
        auctions: 3,
        auctionsWithBidders: 2,
        auctionsSold: 2,
        saleRatioSum: 3,
        forks: 10,
        deadEnds: 1,
        diceRolls: { 1: 30, 2: 10 },
      }),
      record(2, { kind: 'unfinished' }, 30, 10, 1, {
        firstBankruptcyRound: 20,
        finalDay: 29,
        lotteryPool: 1000,
        auctions: 1,
        forks: 20,
        deadEnds: 3,
        diceRolls: { 2: 30, 3: 30 },
      }),
      // Failed games count only for the first bankruptcy.
      record(3, { kind: 'failed', step: 1, failure: { kind: 'missingGameEnded' } }, 1, 1, 1, {
        firstBankruptcyRound: 3,
        finalDay: 999,
        auctions: 99,
        diceRolls: { 3: 1000 },
      }),
    ];
    const summary = summarize(games, 4);
    expect(summary.firstBankruptcyRound).toBe(11);
    expect(summary.finalDay).toBe(39);
    expect(summary.priceIndex).toEqual({ meanFinal: 2, maxFinal: 3, risen: 1, meanRiseRound: 20 });
    expect(summary.auctions).toEqual({ total: 4, withBidders: 2, sold: 2, meanSaleRatio: 1.5 });
    expect(summary.meanLotteryPool).toBe(5000);
    expect(summary.forksPerGame).toBe(15);
    expect(summary.deadEndsPerGame).toBe(2);
    expect(summary.diceRolls).toEqual({ 1: 30, 2: 40, 3: 30 });

    const text = formatStats(summary, 0);
    expect(text).toContain('first in round 11.0 on average');
    expect(text).toContain('final day (games that did not fail): mean 39.0');
    expect(text).toContain('price index at the end: mean 2.00, max 3; above 1 in 1 games');
    expect(text).toContain(
      'auctions: 4 properties, 2 with bidders (50.0%), sold 2 (50.0%), unsold 2; sale / start price mean 1.50',
    );
    expect(text).toContain('lottery pool at the end: mean 5000.0');
    expect(text).toContain('moves per game: forks 15.0, dead-end turnarounds 2.0');
    expect(text).toContain('rolls by dice count (100 rolls): 1 30.0%, 2 40.0%, 3 30.0%');
  });

  it('counts the endings by humans going out, which have no winner', () => {
    const summary = summarize(
      [
        record(1, finished('humanBankrupt', []), 10),
        record(2, finished('noHumansLeft', []), 20),
        record(3, finished('noHumansLeft', []), 30),
      ],
      4,
    );
    expect(summary.reasons).toEqual({
      lastStanding: 0,
      dayLimitOrNetWorthTarget: 0,
      humanBankrupt: 1,
      noHumansLeft: 2,
      noWinner: 0,
    });
    expect(formatStats(summary, 0)).toContain('humanBankrupt 1 (33.3%), noHumansLeft 2 (66.7%)');
  });

  it('averages bank use per game over games that did not fail', () => {
    const games = [
      record(1, { kind: 'unfinished' }, 9, 10, 0, {
        bankOpensPassing: 4,
        bankOpensStopping: 2,
        bankWithdrawals: 2,
        bankWithdrawn: 300,
        bankDeposits: 1,
        bankDeposited: 50,
        bankLeaves: 3,
        bankRebalances: 6,
      }),
      record(2, { kind: 'unfinished' }, 9, 10, 0, { bankWithdrawals: 1, bankWithdrawn: 600 }),
      record(3, { kind: 'failed', step: 1, failure: { kind: 'missingGameEnded' } }, 1, 1, 0, {
        bankOpensPassing: 99,
      }),
    ];
    expect(summarize(games, 4).banks).toEqual({
      opensPassing: 2,
      opensStopping: 1,
      withdrawals: 1.5,
      deposits: 0.5,
      leaves: 1.5,
      rebalances: 3,
      meanWithdrawal: 300,
      meanDeposit: 50,
    });
    expect(formatStats(summarize(games, 4), 0)).toContain(
      'banks per game: humans opened 2.0 passing, 1.0 stopping; withdrew 1.5 (mean 300), ' +
        'deposited 0.5 (mean 50), left 1.5; computer rebalances 3.0',
    );
  });

  it('averages loans per game over games that did not fail', () => {
    const games = [
      record(1, { kind: 'unfinished' }, 9, 10, 0, {
        loanBorrowsHuman: 2,
        loanBorrowedHuman: 1000,
        loanBorrowsComputer: 3,
        loanBorrowedComputer: 6000,
        loanRepaysCounter: 1,
        loanRepaysComputer: 2,
        counterLeaves: 2,
        loanCallIns: 1,
        loanBankruptcies: 1,
      }),
      record(2, { kind: 'unfinished' }, 9, 10, 0, { loanBorrowsComputer: 1 }),
      record(3, { kind: 'failed', step: 1, failure: { kind: 'missingGameEnded' } }, 1, 1, 0, {
        loanBorrowsHuman: 99,
      }),
    ];
    expect(summarize(games, 4).loans).toEqual({
      humanBorrows: 1,
      meanHumanBorrow: 500,
      computerBorrows: 2,
      meanComputerBorrow: 1500,
      counterRepays: 0.5,
      computerRepays: 1,
      counterLeaves: 1,
      callIns: 0.5,
      bankruptcies: 0.5,
    });
    expect(formatStats(summarize(games, 4), 0)).toContain(
      'loans per game: humans borrowed 1.0 (mean 500), repaid 0.5, left the counter 1.0; ' +
        'computers borrowed 2.0 (mean 1500), repaid 1.0; called in 0.5, bankruptcies 0.5',
    );
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
    expect(
      failureKeys({
        kind: 'unofferedNotRefused',
        action,
        outcome: 'accepted',
        expected: 'wrongPhase',
      }),
    ).toEqual(['unofferedNotRefused: buyProperty -> accepted']);
    expect(failureKeys({ kind: 'stepLimit', maxSteps: 9 })).toEqual(['stepLimit']);
    expect(failureKeys({ kind: 'missingGameEnded' })).toEqual(['missingGameEnded']);
    expect(failureKeys({ kind: 'createGame', errors: [{ reason: 'invalidSeed' }] })).toEqual([
      'createGame: invalidSeed',
    ]);
    expect(failureKeys({ kind: 'notOffered', action })).toEqual(['notOffered: buyProperty']);
    expect(failureKeys({ kind: 'computerActionNotLegal', playerId: 'p3', action })).toEqual([
      'computerActionNotLegal: buyProperty',
    ]);
    expect(failureKeys({ kind: 'computerActionNotLegal', playerId: 'p3', action: null })).toEqual([
      'computerActionNotLegal: null',
    ]);
    expect(failureKeys({ kind: 'viewLeak', viewer: 'p1', key: 'rngState' })).toEqual([
      'viewLeak: rngState',
    ]);
    expect(failureKeys({ kind: 'auctionTooLong', tile: 4, actions: 5000 })).toEqual([
      'auctionTooLong',
    ]);
    const transfer = {
      type: 'bankTransfer' as const,
      playerId: 'p1',
      direction: 'deposit' as const,
      amount: 9,
    };
    expect(
      failureKeys({ kind: 'rangeNotEnforced', action: transfer, outcome: 'accepted' }),
    ).toEqual(['rangeNotEnforced: bankTransfer -> accepted']);
    expect(
      failureKeys({ kind: 'bankChangedTotal', playerId: 'p2', before: 100, after: 101 }),
    ).toEqual(['bankChangedTotal']);
    expect(
      describeFailure({ kind: 'bankChangedTotal', playerId: 'p2', before: 100, after: 101 }),
    ).toEqual(["a bank changed p2's cash + deposit from 100 to 101"]);
  });

  it('counts a repeated violation once per game', () => {
    expect(
      failureKeys({
        kind: 'invariant',
        violations: ['tile 1: level 7 is outside 0..5', 'tile 4: level 6 is outside 0..5'],
      }),
    ).toEqual(['invariant: tile #: level # is outside #..#']);
  });
});

describe('formatting', () => {
  const spec: GameSpec = {
    board: 'test-loop',
    controllers: 'mixed',
    vehicle: 'motorbike',
    seed: 12,
    dayLimit: 100,
    netWorthTargetMultiple: null,
    maxDays: 1000,
    maxSteps: 20_000,
  };

  it('formats actions compactly', () => {
    expect(
      formatActions([
        { type: 'rollDice', playerId: 'p1' },
        { type: 'decline', playerId: 'p1' },
      ]),
    ).toBe('p1:rollDice p1:decline');
    expect(
      formatActions([
        { type: 'setDiceCount', playerId: 'p2', count: 2 },
        { type: 'bid', playerId: 'p3', raise: 500 },
      ]),
    ).toBe('p2:setDiceCount(2) p3:bid(500)');
    expect(
      formatActions([
        { type: 'bankTransfer', playerId: 'p1', direction: 'withdraw', amount: 30 },
        { type: 'bankTransfer', playerId: 'p1', direction: 'deposit', max: 70 },
      ]),
    ).toBe('p1:bankTransfer(withdraw 30) p1:bankTransfer(deposit 1..70)');
  });

  it('adds --tables to the rerun command when characters came from a file', () => {
    const characters = { path: 'C:/x/tables.json', profiles: [] };
    expect(rerunCommand({ ...spec, characters })).toBe(
      `${rerunCommand(spec)} --tables C:/x/tables.json`,
    );
  });

  it('builds a rerun command for one game', () => {
    expect(rerunCommand(spec)).toBe(
      'pnpm -F sim sim -- --games 1 --seed 12 --board test-loop --controllers mixed --vehicle motorbike --day-limit 100 --max-days 1000 --max-steps 20000',
    );
    expect(rerunCommand({ ...spec, dayLimit: null, netWorthTargetMultiple: 3 })).toBe(
      'pnpm -F sim sim -- --games 1 --seed 12 --board test-loop --controllers mixed --vehicle motorbike --net-worth-target 3 --max-days 1000 --max-steps 20000',
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
    expect(text).toContain(
      'rounds (finished games): mean 67.5, median 40, p90 100, min 30, max 100',
    );
    expect(text).toContain('lastStanding 2 (25.0%, 1 without a winner)');
    expect(text).toContain('dayLimitOrNetWorthTarget 2 (25.0%)');
    expect(text).toContain('seat 0 25.0%');
    expect(text).toContain('seat 1 12.5%');
    expect(text).toContain('tied games: 1');
    expect(text).toContain('2x invariant: player p#: cash # is not a non-negative integer');
    expect(text).toContain('elapsed: 2.5s');
  });
});
