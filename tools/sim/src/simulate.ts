// Runs a parsed command against injected I/O; main.ts supplies the real console and files.
import { ENGINE_VERSION } from '@richman/shared';
import type { Command, RunOptions } from './args';
import {
  ENGINE,
  PLAYER_COUNT,
  gameSeedFor,
  runGame,
  type Engine,
  type GameRecord,
  type GameSpec,
} from './game';
import { parseGameLog, replay, reproduces, toGameLog, type GameLog } from './replay';
import { describeFailure, formatFailureDetail, formatStats, summarize } from './stats';

export interface SimIO {
  print(text: string): void;
  /** Writes a failure log and returns the path to show in the replay command. */
  writeLog(name: string, text: string): string;
  readFile(path: string): string;
  now(): number;
}

/** Returns the process exit code: 0 ok, 1 failures, 2 unusable input. */
export function runCommand(command: Command, io: SimIO, engine: Engine = ENGINE): number {
  return command.kind === 'run'
    ? simulate(command.options, io, engine)
    : replayFile(command.file, io, engine);
}

function simulate(options: RunOptions, io: SimIO, engine: Engine): number {
  const start = io.now();
  const records: GameRecord[] = [];
  let failures = 0;
  for (let index = 0; index < options.games; index++) {
    const spec: GameSpec = {
      board: options.board,
      controllers: options.controllers,
      seed: gameSeedFor(options.seed, index),
      dayLimit: options.dayLimit,
      netWorthTargetMultiple: options.netWorthTargetMultiple,
      maxDays: options.maxDays,
      maxSteps: options.maxSteps,
    };
    const record = runGame(spec, engine);
    records.push(record);
    if (record.outcome.kind !== 'failed') {
      continue;
    }
    const log = toGameLog(spec, record);
    const path = io.writeLog(`failure-${spec.seed}.json`, `${JSON.stringify(log, null, 2)}\n`);
    if (failures < options.maxFailureDetails) {
      io.print(formatFailureDetail(index, options.seed, record, spec, path));
      io.print('');
    }
    failures++;
  }

  const hidden = failures - options.maxFailureDetails;
  if (hidden > 0) {
    io.print(`${hidden} more failures written to out/ without details`);
    io.print('');
  }
  io.print(formatStats(summarize(records, PLAYER_COUNT), io.now() - start));
  return failures > 0 ? 1 : 0;
}

function replayFile(file: string, io: SimIO, engine: Engine): number {
  let text: string;
  try {
    text = io.readFile(file);
  } catch (error) {
    io.print(`cannot read ${file}: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
  const parsed = parseGameLog(text);
  if (!parsed.ok) {
    io.print(`${file} is not a usable game log:`);
    for (const error of parsed.errors) io.print(`  ${error}`);
    return 2;
  }

  const { log } = parsed;
  io.print(`replaying ${file}: game seed ${log.seed}, ${log.actions.length} actions`);
  if (log.engineVersion !== ENGINE_VERSION) {
    io.print(`warning: logged with engine ${log.engineVersion}, running ${ENGINE_VERSION}`);
  }
  const result = replay(log, engine);
  if (result.kind === 'completed') {
    const over = result.state.turn.phase.kind === 'gameOver';
    io.print(`result: completed ${result.steps} steps, ${over ? 'game over' : 'game not over'}`);
  } else {
    io.print(`result: failed at step ${result.step}`);
    for (const line of describeFailure(result.failure)) io.print(`  ${line}`);
  }
  io.print(`recorded: ${describeRecorded(log)}`);
  io.print(`reproduced: ${reproduces(log, result) ? 'yes' : 'no'}`);
  return result.kind === 'failed' ? 1 : 0;
}

function describeRecorded({ outcome, actions }: GameLog): string {
  switch (outcome.kind) {
    case 'finished':
      return `finished (${outcome.reason}) after ${actions.length} steps`;
    case 'unfinished':
      return `unfinished after ${actions.length} steps`;
    case 'failed':
      return `failed at step ${outcome.step}: ${describeFailure(outcome.failure)[0] ?? ''}`;
  }
}
