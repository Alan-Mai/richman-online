// Run statistics and the text the simulator prints. Output is plain ASCII English so it reads the
// same in any Windows console code page.
import type { Action } from '@richman/shared';
import type { EndReason, GameMetrics, GameRecord, GameSpec } from './game';
import type { ReplayFailure } from './replay';

export interface Stats {
  games: number;
  finished: number;
  unfinished: number;
  failed: number;
  /**
   * noWinner counts the lastStanding endings with nobody left (also counted in lastStanding); the
   * endings by humans going out never have a winner.
   */
  reasons: Record<EndReason, number> & { noWinner: number };
  /** Over finished games; null when none finished. */
  rounds: { mean: number; median: number; p90: number; min: number; max: number } | null;
  /** Over games that did not fail; null when all failed. */
  meanSteps: number | null;
  /** Wins per seat; a tie between k winners gives each 1/k. */
  seatWins: number[];
  tiedGames: number;
  bankruptcies: number;
  /** Mean round of the first bankruptcy over games that had one; null when none did. */
  firstBankruptcyRound: number | null;
  /** The rest are over games that did not fail; null when all failed. */
  finalDay: number | null;
  priceIndex: {
    meanFinal: number;
    maxFinal: number;
    /** Games where it ever went above 1, and the mean round when it first did. */
    risen: number;
    meanRiseRound: number | null;
  } | null;
  auctions: {
    /** Properties put up, with anyone allowed to bid, and sold. */
    total: number;
    withBidders: number;
    sold: number;
    /** Mean sale price / start price over the properties sold. */
    meanSaleRatio: number | null;
  };
  meanLotteryPool: number | null;
  forksPerGame: number | null;
  deadEndsPerGame: number | null;
  /** Rolls by dice count over the games that did not fail: diceRolls[n] rolls of n dice. */
  diceRolls: Record<number, number>;
  /** Most frequent first, each with the seed of the first game that showed it. */
  failureGroups: { key: string; count: number; seed: number }[];
}

const mean = (values: readonly number[]): number =>
  values.reduce((sum, v) => sum + v, 0) / values.length;

/** The nearest-rank quantile: the smallest value with at least q of the values at or below it. */
export function quantile(values: readonly number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil(q * sorted.length));
  return sorted[rank - 1] ?? NaN;
}

export function summarize(records: readonly GameRecord[], seats: number): Stats {
  const stats: Stats = {
    games: records.length,
    finished: 0,
    unfinished: 0,
    failed: 0,
    reasons: {
      lastStanding: 0,
      dayLimitOrNetWorthTarget: 0,
      humanBankrupt: 0,
      noHumansLeft: 0,
      noWinner: 0,
    },
    rounds: null,
    meanSteps: null,
    seatWins: Array.from({ length: seats }, () => 0),
    tiedGames: 0,
    bankruptcies: 0,
    firstBankruptcyRound: null,
    finalDay: null,
    priceIndex: null,
    auctions: { total: 0, withBidders: 0, sold: 0, meanSaleRatio: null },
    meanLotteryPool: null,
    forksPerGame: null,
    deadEndsPerGame: null,
    diceRolls: {},
    failureGroups: [],
  };
  const finishedRounds: number[] = [];
  const steps: number[] = [];
  const groups = new Map<string, { key: string; count: number; seed: number }>();

  const played = records.filter((r) => r.outcome.kind !== 'failed').map((r) => r.metrics);
  const firstBankruptcies = records.flatMap((r) =>
    r.metrics.firstBankruptcyRound === null ? [] : [r.metrics.firstBankruptcyRound],
  );
  stats.firstBankruptcyRound = firstBankruptcies.length > 0 ? mean(firstBankruptcies) : null;
  if (played.length > 0) {
    const rises = played.flatMap((m) =>
      m.priceIndexRiseRound === null ? [] : [m.priceIndexRiseRound],
    );
    stats.finalDay = mean(played.map((m) => m.finalDay));
    stats.priceIndex = {
      meanFinal: mean(played.map((m) => m.finalPriceIndex)),
      maxFinal: Math.max(...played.map((m) => m.finalPriceIndex)),
      risen: rises.length,
      meanRiseRound: rises.length > 0 ? mean(rises) : null,
    };
    stats.meanLotteryPool = mean(played.map((m) => m.lotteryPool));
    stats.forksPerGame = mean(played.map((m) => m.forks));
    stats.deadEndsPerGame = mean(played.map((m) => m.deadEnds));
    for (const m of played) {
      for (const [n, rolls] of Object.entries(m.diceRolls)) {
        stats.diceRolls[Number(n)] = (stats.diceRolls[Number(n)] ?? 0) + rolls;
      }
    }
  }
  const sum = (pick: (m: GameMetrics) => number) => played.reduce((total, m) => total + pick(m), 0);
  const sold = sum((m) => m.auctionsSold);
  stats.auctions = {
    total: sum((m) => m.auctions),
    withBidders: sum((m) => m.auctionsWithBidders),
    sold,
    meanSaleRatio: sold > 0 ? sum((m) => m.saleRatioSum) / sold : null,
  };

  for (const { seed, actions, rounds, bankruptcies, outcome } of records) {
    stats.bankruptcies += bankruptcies;
    switch (outcome.kind) {
      case 'finished': {
        stats.finished++;
        stats.reasons[outcome.reason]++;
        const winners = outcome.winnerSeats;
        if (winners.length === 0 && outcome.reason === 'lastStanding') stats.reasons.noWinner++;
        if (winners.length > 1) stats.tiedGames++;
        for (const seat of winners) {
          stats.seatWins[seat] = (stats.seatWins[seat] ?? 0) + 1 / winners.length;
        }
        finishedRounds.push(rounds);
        steps.push(actions.length);
        break;
      }
      case 'unfinished':
        stats.unfinished++;
        steps.push(actions.length);
        break;
      case 'failed':
        stats.failed++;
        for (const key of failureKeys(outcome.failure)) {
          const group = groups.get(key) ?? { key, count: 0, seed };
          group.count++;
          groups.set(key, group);
        }
        break;
    }
  }

  if (finishedRounds.length > 0) {
    stats.rounds = {
      mean: mean(finishedRounds),
      median: quantile(finishedRounds, 0.5),
      p90: quantile(finishedRounds, 0.9),
      min: Math.min(...finishedRounds),
      max: Math.max(...finishedRounds),
    };
  }
  stats.meanSteps = steps.length > 0 ? mean(steps) : null;
  // Map keeps insertion order and sort is stable, so equal counts stay in first-seen order.
  stats.failureGroups = [...groups.values()].sort((a, b) => b.count - a.count);
  return stats;
}

/** Ids and amounts differ between games hitting the same bug; replace numbers so they group. */
const normalize = (text: string): string => text.replace(/-?\d+(\.\d+)?/g, '#');

/** Grouping keys for one failed game; each key once. */
export function failureKeys(failure: ReplayFailure): string[] {
  switch (failure.kind) {
    case 'invariant':
      return [...new Set(failure.violations.map((v) => `invariant: ${normalize(v)}`))];
    case 'createGame':
      return [`createGame: ${failure.errors.map((e) => e.reason).join(', ')}`];
    case 'offeredOutOfTurn':
      return [`offeredOutOfTurn: ${failure.actions.map((a) => a.type).join(', ')}`];
    case 'legalActionRejected':
      return [`legalActionRejected: ${failure.action.type} -> ${failure.error.code}`];
    case 'unofferedNotRefused':
      return [`unofferedNotRefused: ${failure.action.type} -> ${failure.outcome}`];
    case 'notOffered':
      return [`notOffered: ${failure.action.type}`];
    case 'computerActionNotLegal':
      return [`computerActionNotLegal: ${failure.action?.type ?? 'null'}`];
    case 'viewLeak':
      return [`viewLeak: ${failure.key}`];
    case 'exception':
      return [`exception: ${normalize(failure.message)}`];
    case 'noLegalActions':
    case 'priceIndexFell':
    case 'missingGameEnded':
    case 'stepLimit':
    case 'auctionTooLong':
      return [failure.kind];
  }
}

/** One line per problem, for people. */
export function describeFailure(failure: ReplayFailure): string[] {
  switch (failure.kind) {
    case 'createGame':
      return [`createGame rejected the setup: ${JSON.stringify(failure.errors)}`];
    case 'invariant':
      return ['invariants violated:', ...failure.violations.map((v) => `  ${v}`)];
    case 'priceIndexFell':
      return [`price index fell from ${failure.from} to ${failure.to}`];
    case 'noLegalActions':
      return [`no legal actions for current player ${failure.playerId}`];
    case 'offeredOutOfTurn':
      return [`${failure.playerId} was offered ${formatActions(failure.actions)} out of turn`];
    case 'legalActionRejected':
      return [
        `offered ${formatActions([failure.action])} was rejected: ${JSON.stringify(failure.error)}`,
      ];
    case 'unofferedNotRefused':
      return [
        `unoffered ${formatActions([failure.action])} was ${failure.outcome}, expected ${failure.expected}`,
      ];
    case 'notOffered':
      return [`logged ${formatActions([failure.action])} is not a legal action`];
    case 'computerActionNotLegal': {
      const picked = failure.action === null ? 'nothing' : formatActions([failure.action]);
      return [`computerAction for ${failure.playerId} gave ${picked}, which is not a legal choice`];
    }
    case 'viewLeak':
      return [`the view for ${failure.viewer} contains hidden ${failure.key}`];
    case 'auctionTooLong':
      return [`the auction of tile ${failure.tile} took ${failure.actions} actions`];
    case 'missingGameEnded':
      return ['game over without a GameEnded event'];
    case 'stepLimit':
      return [`game did not end within ${failure.maxSteps} steps`];
    case 'exception':
      return [`exception: ${failure.message}`, ...(failure.stack?.split('\n') ?? [])];
  }
}

function diceLine(rolls: Readonly<Record<number, number>>): string {
  const counts = Object.entries(rolls).map(([n, count]) => [Number(n), count] as const);
  const total = counts.reduce((sum, [, count]) => sum + count, 0);
  if (total === 0) return 'rolls by dice count: n/a';
  const parts = counts.sort(([a], [b]) => a - b).map(([n, c]) => `${n} ${percent(c, total)}`);
  return `rolls by dice count (${total} rolls): ${parts.join(', ')}`;
}

/** One token per action; parameters follow the type (raise of a bid, dice count). */
export function formatActions(actions: readonly Action[]): string {
  return actions
    .map((a) => {
      const parameter = a.type === 'bid' ? a.raise : a.type === 'setDiceCount' ? a.count : null;
      return `${a.playerId}:${a.type}${parameter === null ? '' : `(${parameter})`}`;
    })
    .join(' ');
}

/** Reruns one game with the same players; same seed, same choices. */
export function rerunCommand(spec: GameSpec): string {
  const days = spec.dayLimit === null ? '' : ` --day-limit ${spec.dayLimit}`;
  const target =
    spec.netWorthTargetMultiple === null
      ? ''
      : ` --net-worth-target ${spec.netWorthTargetMultiple}`;
  return `pnpm -F sim sim -- --games 1 --seed ${spec.seed} --board ${spec.board} --controllers ${spec.controllers} --vehicle ${spec.vehicle}${days}${target} --max-days ${spec.maxDays} --max-steps ${spec.maxSteps}`;
}

export function formatFailureDetail(
  index: number,
  runSeed: number,
  record: GameRecord,
  spec: GameSpec,
  logPath: string,
): string {
  const { outcome } = record;
  if (outcome.kind !== 'failed') {
    return '';
  }
  return [
    `FAIL game #${index} (run seed ${runSeed}), game seed ${record.seed}, failed at step ${outcome.step}`,
    ...describeFailure(outcome.failure).map((line) => `  ${line}`),
    `  actions (${record.actions.length}): ${formatActions(record.actions)}`,
    `  rerun:  ${rerunCommand(spec)}`,
    `  replay: pnpm -F sim sim -- replay ${logPath}`,
  ].join('\n');
}

const percent = (part: number, whole: number): string =>
  whole === 0 ? 'n/a' : `${((part / whole) * 100).toFixed(1)}%`;

const fixed = (value: number | null): string => (value === null ? 'n/a' : value.toFixed(1));

function priceIndexLine({ priceIndex }: Stats): string {
  if (priceIndex === null) return 'price index at the end: n/a';
  const { meanFinal, maxFinal, risen, meanRiseRound } = priceIndex;
  return (
    `price index at the end: mean ${meanFinal.toFixed(2)}, max ${maxFinal}; ` +
    `above 1 in ${risen} games, first in round ${fixed(meanRiseRound)} on average`
  );
}

function auctionLine({ total, withBidders, sold, meanSaleRatio }: Stats['auctions']): string {
  const ratio = meanSaleRatio === null ? 'n/a' : meanSaleRatio.toFixed(2);
  return (
    `auctions: ${total} properties, ${withBidders} with bidders (${percent(withBidders, total)}), ` +
    `sold ${sold} (${percent(sold, total)}), unsold ${total - sold}; sale / start price mean ${ratio}`
  );
}

export function formatStats(stats: Stats, elapsedMs: number): string {
  const { games, finished, reasons, rounds } = stats;
  const lines = [
    `games: ${games} (finished ${finished}, unfinished ${stats.unfinished}, failed ${stats.failed})`,
    rounds === null
      ? 'rounds (finished games): n/a'
      : `rounds (finished games): mean ${rounds.mean.toFixed(1)}, median ${rounds.median}, p90 ${rounds.p90}, min ${rounds.min}, max ${rounds.max}`,
    `steps (games that did not fail): ${stats.meanSteps === null ? 'n/a' : `mean ${stats.meanSteps.toFixed(1)}`}`,
    `end reasons: lastStanding ${reasons.lastStanding} (${percent(reasons.lastStanding, games)}, ` +
      `${reasons.noWinner} without a winner), ` +
      `dayLimitOrNetWorthTarget ${reasons.dayLimitOrNetWorthTarget} ` +
      `(${percent(reasons.dayLimitOrNetWorthTarget, games)}), ` +
      `humanBankrupt ${reasons.humanBankrupt} (${percent(reasons.humanBankrupt, games)}), ` +
      `noHumansLeft ${reasons.noHumansLeft} (${percent(reasons.noHumansLeft, games)}), ` +
      `unfinished ${stats.unfinished} (${percent(stats.unfinished, games)}), ` +
      `failed ${stats.failed} (${percent(stats.failed, games)})`,
    `seat win rate (ties split 1/k, out of ${finished} finished): ` +
      stats.seatWins.map((wins, seat) => `seat ${seat} ${percent(wins, finished)}`).join(', '),
    `tied games: ${stats.tiedGames}`,
    `bankruptcies: ${stats.bankruptcies} (${games === 0 ? 'n/a' : (stats.bankruptcies / games).toFixed(2)} per game)` +
      `, first in round ${fixed(stats.firstBankruptcyRound)} on average`,
    `final day (games that did not fail): mean ${fixed(stats.finalDay)}`,
    priceIndexLine(stats),
    auctionLine(stats.auctions),
    `lottery pool at the end: mean ${fixed(stats.meanLotteryPool)}`,
    `moves per game: forks ${fixed(stats.forksPerGame)}, dead-end turnarounds ${fixed(stats.deadEndsPerGame)}`,
    diceLine(stats.diceRolls),
  ];
  if (stats.failureGroups.length > 0) {
    lines.push('failure groups:');
    for (const { key, count, seed } of stats.failureGroups) {
      lines.push(`  ${count}x ${key} (e.g. game seed ${seed})`);
    }
  }
  lines.push(`elapsed: ${(elapsedMs / 1000).toFixed(1)}s`);
  return lines.join('\n');
}
