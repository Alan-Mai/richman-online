// Run statistics and the text the simulator prints. Output is plain ASCII English so it reads the
// same in any Windows console code page.
import type { Action } from '@richman/shared';
import type { GameRecord, GameSpec } from './game';
import type { ReplayFailure } from './replay';

export interface Stats {
  games: number;
  finished: number;
  unfinished: number;
  failed: number;
  /** noWinner counts the lastStanding endings with nobody left (also counted in lastStanding). */
  reasons: { roundLimit: number; lastStanding: number; noWinner: number };
  /** Over finished games; null when none finished. */
  rounds: { mean: number; min: number; max: number } | null;
  /** Over games that did not fail; null when all failed. */
  meanSteps: number | null;
  /** Wins per seat; a tie between k winners gives each 1/k. */
  seatWins: number[];
  tiedGames: number;
  bankruptcies: number;
  /** Most frequent first, each with the seed of the first game that showed it. */
  failureGroups: { key: string; count: number; seed: number }[];
}

const mean = (values: readonly number[]): number =>
  values.reduce((sum, v) => sum + v, 0) / values.length;

export function summarize(records: readonly GameRecord[], seats: number): Stats {
  const stats: Stats = {
    games: records.length,
    finished: 0,
    unfinished: 0,
    failed: 0,
    reasons: { roundLimit: 0, lastStanding: 0, noWinner: 0 },
    rounds: null,
    meanSteps: null,
    seatWins: Array.from({ length: seats }, () => 0),
    tiedGames: 0,
    bankruptcies: 0,
    failureGroups: [],
  };
  const finishedRounds: number[] = [];
  const steps: number[] = [];
  const groups = new Map<string, { key: string; count: number; seed: number }>();

  for (const { seed, actions, rounds, bankruptcies, outcome } of records) {
    stats.bankruptcies += bankruptcies;
    switch (outcome.kind) {
      case 'finished': {
        stats.finished++;
        stats.reasons[outcome.reason]++;
        const winners = outcome.winnerSeats;
        if (winners.length === 0) stats.reasons.noWinner++;
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
    case 'exception':
      return [`exception: ${normalize(failure.message)}`];
    case 'noLegalActions':
    case 'missingGameEnded':
    case 'stepLimit':
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
        `unoffered ${formatActions([failure.action])} was ${failure.outcome}, expected wrongPhase`,
      ];
    case 'notOffered':
      return [`logged ${formatActions([failure.action])} is not a legal action`];
    case 'missingGameEnded':
      return ['game over without a GameEnded event'];
    case 'stepLimit':
      return [`game did not end within ${failure.maxSteps} steps`];
    case 'exception':
      return [`exception: ${failure.message}`, ...(failure.stack?.split('\n') ?? [])];
  }
}

export function formatActions(actions: readonly Action[]): string {
  return actions.map((a) => `${a.playerId}:${a.type}`).join(' ');
}

/** Reruns one game through the random AI; same seed, same choices. */
export function rerunCommand(spec: GameSpec): string {
  const rounds = spec.maxRounds === null ? '' : ` --max-rounds ${spec.maxRounds}`;
  return `pnpm -F sim sim -- --games 1 --seed ${spec.seed} --win ${spec.win}${rounds} --max-steps ${spec.maxSteps}`;
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

export function formatStats(stats: Stats, elapsedMs: number): string {
  const { games, finished, reasons, rounds } = stats;
  const lines = [
    `games: ${games} (finished ${finished}, unfinished ${stats.unfinished}, failed ${stats.failed})`,
    rounds === null
      ? 'rounds (finished games): n/a'
      : `rounds (finished games): mean ${rounds.mean.toFixed(1)}, min ${rounds.min}, max ${rounds.max}`,
    `steps (games that did not fail): ${stats.meanSteps === null ? 'n/a' : `mean ${stats.meanSteps.toFixed(1)}`}`,
    `end reasons: roundLimit ${reasons.roundLimit} (${percent(reasons.roundLimit, games)}), ` +
      `lastStanding ${reasons.lastStanding} (${percent(reasons.lastStanding, games)}, ` +
      `${reasons.noWinner} without a winner), ` +
      `unfinished ${stats.unfinished} (${percent(stats.unfinished, games)}), ` +
      `failed ${stats.failed} (${percent(stats.failed, games)})`,
    `seat win rate (ties split 1/k, out of ${finished} finished): ` +
      stats.seatWins.map((wins, seat) => `seat ${seat + 1} ${percent(wins, finished)}`).join(', '),
    `tied games: ${stats.tiedGames}`,
    `bankruptcies: ${stats.bankruptcies} (${games === 0 ? 'n/a' : (stats.bankruptcies / games).toFixed(2)} per game)`,
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
