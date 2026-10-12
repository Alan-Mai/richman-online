// One simulated game: random legal actions, with every step checked.
import {
  DEFAULT_RULE_CONFIG,
  TEST_LOOP_BOARD,
  applyAction,
  checkInvariants,
  createGame,
  createRng,
  legalActions,
  nextInt,
  type Action,
  type ActionType,
  type CreateGameError,
  type GameSetup,
  type GameState,
  type PlayerId,
  type RuleError,
  type WinCondition,
} from '@richman/shared';

/** The engine functions the simulator calls; tests swap in broken ones. */
export interface Engine {
  createGame: typeof createGame;
  applyAction: typeof applyAction;
  legalActions: typeof legalActions;
  checkInvariants: typeof checkInvariants;
}

export const ENGINE: Engine = { createGame, applyAction, legalActions, checkInvariants };

export const PLAYER_COUNT = 4;

/** A Record so adding an ActionType without listing it here is a type error. */
const ACTION_TYPES = Object.keys({
  rollDice: true,
  buyProperty: true,
  upgradeProperty: true,
  decline: true,
} satisfies Record<ActionType, true>) as ActionType[];

export interface GameSpec {
  seed: number;
  win: WinCondition;
  maxRounds: number | null;
  maxSteps: number;
}

export type Failure =
  | { kind: 'createGame'; errors: CreateGameError[] }
  | { kind: 'invariant'; violations: string[] }
  | { kind: 'noLegalActions'; playerId: PlayerId }
  /** Someone other than the current player (or anyone after game over) was offered actions. */
  | { kind: 'offeredOutOfTurn'; playerId: PlayerId; actions: Action[] }
  | { kind: 'legalActionRejected'; action: Action; error: RuleError }
  /** An action type missing from legalActions was not refused with wrongPhase. */
  | { kind: 'unofferedNotRefused'; action: Action; outcome: string }
  | { kind: 'missingGameEnded' }
  | { kind: 'stepLimit'; maxSteps: number }
  | { kind: 'exception'; message: string; stack?: string };

export type Outcome =
  | { kind: 'finished'; reason: 'lastStanding' | 'roundLimit'; winnerSeats: number[] }
  | { kind: 'unfinished' }
  /** `step` = number of actions applied before the failure was found. */
  | { kind: 'failed'; step: number; failure: Failure };

export interface GameRecord {
  seed: number;
  actions: Action[];
  rounds: number;
  bankruptcies: number;
  outcome: Outcome;
}

/** Game i of a run uses seed + i, wrapping at 2^32. */
export function gameSeedFor(seed: number, index: number): number {
  return (seed + index) >>> 0;
}

/** Seed of the RNG that picks actions; separate from the game's own rngState. */
export function chooserSeedFor(gameSeed: number): number {
  return (gameSeed ^ 0x5eed) >>> 0;
}

export function gameSetup(spec: Pick<GameSpec, 'seed' | 'win' | 'maxRounds'>): GameSetup {
  return {
    config: { ...DEFAULT_RULE_CONFIG, winCondition: spec.win, maxRounds: spec.maxRounds },
    board: TEST_LOOP_BOARD,
    players: Array.from({ length: PLAYER_COUNT }, (_, i) => ({
      id: `p${i + 1}`,
      name: `AI ${i + 1}`,
    })),
    seed: spec.seed,
  };
}

/**
 * Checks one state before an action is chosen: invariants hold, nobody but the current player is
 * offered anything (nobody at all after game over), every offered action is accepted and every
 * other action type is refused with wrongPhase. May throw if the engine does.
 */
export function checkStep(engine: Engine, state: GameState): Failure | null {
  const violations = engine.checkInvariants(state);
  if (violations.length > 0) {
    return { kind: 'invariant', violations };
  }
  const over = state.turn.phase.kind === 'gameOver';
  const current = state.turn.current;
  for (const { id } of state.players) {
    if (over || id !== current) {
      const offered = engine.legalActions(state, id);
      if (offered.length > 0) {
        return { kind: 'offeredOutOfTurn', playerId: id, actions: offered };
      }
    }
  }
  if (over) {
    return null;
  }

  const legal = engine.legalActions(state, current);
  if (legal.length === 0) {
    return { kind: 'noLegalActions', playerId: current };
  }
  for (const action of legal) {
    const result = engine.applyAction(state, action);
    if (!result.ok) {
      return { kind: 'legalActionRejected', action, error: result.error };
    }
  }
  for (const type of ACTION_TYPES) {
    if (!legal.some((a) => a.type === type)) {
      const action: Action = { type, playerId: current };
      const result = engine.applyAction(state, action);
      if (result.ok || result.error.code !== 'wrongPhase') {
        return {
          kind: 'unofferedNotRefused',
          action,
          outcome: result.ok ? 'accepted' : result.error.code,
        };
      }
    }
  }
  return null;
}

export function exceptionFailure(error: unknown): Failure {
  return error instanceof Error
    ? { kind: 'exception', message: error.message, ...(error.stack ? { stack: error.stack } : {}) }
    : { kind: 'exception', message: String(error) };
}

/** Plays one game with uniformly random legal actions. Never throws: problems become failures. */
export function runGame(spec: GameSpec, engine: Engine = ENGINE): GameRecord {
  const actions: Action[] = [];
  let rounds = 0;
  let bankruptcies = 0;
  const record = (outcome: Outcome): GameRecord => ({
    seed: spec.seed,
    actions,
    rounds,
    bankruptcies,
    outcome,
  });
  const fail = (failure: Failure) => record({ kind: 'failed', step: actions.length, failure });

  try {
    const created = engine.createGame(gameSetup(spec));
    if (!created.ok) {
      return fail({ kind: 'createGame', errors: created.errors });
    }
    let state = created.state;
    let chooser = createRng(chooserSeedFor(spec.seed));
    let ending: { reason: 'lastStanding' | 'roundLimit'; winners: readonly PlayerId[] } | null =
      null;
    for (;;) {
      rounds = state.turn.round;
      const failure = checkStep(engine, state);
      if (failure !== null) {
        return fail(failure);
      }
      if (state.turn.phase.kind === 'gameOver') {
        break;
      }
      if (actions.length >= spec.maxSteps) {
        return spec.win === 'lastStanding'
          ? record({ kind: 'unfinished' })
          : fail({ kind: 'stepLimit', maxSteps: spec.maxSteps });
      }

      const legal = engine.legalActions(state, state.turn.current);
      const [pick, next] = nextInt(chooser, legal.length);
      chooser = next;
      const action = legal[pick];
      if (action === undefined) {
        throw new Error(`picked ${pick} of ${legal.length} actions`);
      }
      const result = engine.applyAction(state, action);
      if (!result.ok) {
        return fail({ kind: 'legalActionRejected', action, error: result.error });
      }
      actions.push(action);
      state = result.state;
      for (const event of result.events) {
        if (event.type === 'PlayerBankrupt') bankruptcies++;
        if (event.type === 'GameEnded') ending = { reason: event.reason, winners: event.winners };
      }
    }

    if (ending === null) {
      return fail({ kind: 'missingGameEnded' });
    }
    const seats = state.players.map((p) => p.id);
    return record({
      kind: 'finished',
      reason: ending.reason,
      winnerSeats: ending.winners.map((id) => seats.indexOf(id)),
    });
  } catch (error) {
    return fail(exceptionFailure(error));
  }
}
