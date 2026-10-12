// Failure logs and replaying them from the recorded actions alone (no AI involved), the same way
// a server would rebuild a game from its initial setup and action record.
import {
  ENGINE_VERSION,
  TEST_LOOP_BOARD,
  type Action,
  type GameState,
  type PlayerSetup,
  type RuleConfig,
} from '@richman/shared';
import {
  ENGINE,
  checkStep,
  exceptionFailure,
  gameSetup,
  type Engine,
  type Failure,
  type GameRecord,
  type GameSpec,
  type Outcome,
} from './game';

export interface GameLog {
  version: 1;
  engineVersion: string;
  /** Board id; only the built-in test board is supported. */
  board: string;
  config: RuleConfig;
  players: PlayerSetup[];
  seed: number;
  maxSteps: number;
  actions: Action[];
  /** What the simulator saw, so a replay can tell whether it reproduced it. */
  outcome: Outcome;
}

export type ReplayFailure = Failure | { kind: 'notOffered'; action: Action };

export type ReplayResult =
  | { kind: 'completed'; steps: number; state: GameState }
  | { kind: 'failed'; step: number; failure: ReplayFailure };

export function toGameLog(spec: GameSpec, record: GameRecord): GameLog {
  const { config, board, players, seed } = gameSetup(spec);
  return {
    version: 1,
    engineVersion: ENGINE_VERSION,
    board: board.id,
    config,
    players: [...players],
    seed,
    maxSteps: spec.maxSteps,
    actions: record.actions,
    outcome: record.outcome,
  };
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Checks the outer shape; field values are left to createGame and applyAction to validate. */
export function parseGameLog(
  text: string,
): { ok: true; log: GameLog } | { ok: false; errors: string[] } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, errors: ['not valid JSON'] };
  }
  if (!isObject(data)) {
    return { ok: false, errors: ['not a game log object'] };
  }
  if (data.version !== 1) {
    return { ok: false, errors: [`unsupported log version ${String(data.version)}`] };
  }

  const errors: string[] = [];
  if (data.board !== TEST_LOOP_BOARD.id) {
    errors.push(`unknown board ${String(data.board)}`);
  }
  if (!isObject(data.config)) {
    errors.push('config must be an object');
  }
  const players = data.players;
  if (
    !Array.isArray(players) ||
    !players.every((p) => isObject(p) && typeof p.id === 'string' && typeof p.name === 'string')
  ) {
    errors.push('players must be {id, name} strings');
  }
  if (typeof data.seed !== 'number') {
    errors.push('seed must be a number');
  }
  if (typeof data.maxSteps !== 'number') {
    errors.push('maxSteps must be a number');
  }
  if (!Array.isArray(data.actions) || !data.actions.every(isObject)) {
    errors.push('actions must be an array of objects');
  }
  if (!isObject(data.outcome)) {
    errors.push('outcome must be an object');
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, log: data as unknown as GameLog };
}

const sameAction = (a: Action, b: Action): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * Applies the logged actions one by one with the same per-step checks as the simulator, plus a
 * check that each logged action was offered. Stops at the first problem. Never throws.
 */
export function replay(log: GameLog, engine: Engine = ENGINE): ReplayResult {
  let step = 0;
  try {
    const created = engine.createGame({
      config: log.config,
      board: TEST_LOOP_BOARD,
      players: log.players,
      seed: log.seed,
    });
    if (!created.ok) {
      return { kind: 'failed', step, failure: { kind: 'createGame', errors: created.errors } };
    }
    let state = created.state;
    for (const action of log.actions) {
      const failure = checkStep(engine, state);
      if (failure !== null) {
        return { kind: 'failed', step, failure };
      }
      if (!engine.legalActions(state, state.turn.current).some((a) => sameAction(a, action))) {
        return { kind: 'failed', step, failure: { kind: 'notOffered', action } };
      }
      const result = engine.applyAction(state, action);
      if (!result.ok) {
        return {
          kind: 'failed',
          step,
          failure: { kind: 'legalActionRejected', action, error: result.error },
        };
      }
      state = result.state;
      step++;
    }
    const failure = checkStep(engine, state);
    return failure === null
      ? { kind: 'completed', steps: step, state }
      : { kind: 'failed', step, failure };
  } catch (error) {
    return { kind: 'failed', step, failure: exceptionFailure(error) };
  }
}

const withoutStack = (failure: ReplayFailure): string =>
  JSON.stringify(failure.kind === 'exception' ? { ...failure, stack: undefined } : failure);

/** Whether the replay ended the way the simulator recorded. */
export function reproduces(log: GameLog, result: ReplayResult): boolean {
  const { outcome } = log;
  const completedAt = (steps: number, over: boolean) =>
    result.kind === 'completed' &&
    result.steps === steps &&
    (result.state.turn.phase.kind === 'gameOver') === over;

  switch (outcome.kind) {
    case 'finished':
      return completedAt(log.actions.length, true);
    case 'unfinished':
      return completedAt(log.actions.length, false);
    case 'failed':
      if (outcome.failure.kind === 'stepLimit') {
        return completedAt(outcome.failure.maxSteps, false);
      }
      return (
        result.kind === 'failed' &&
        result.step === outcome.step &&
        withoutStack(result.failure) === withoutStack(outcome.failure)
      );
  }
}
