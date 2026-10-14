// One simulated game: random legal actions, with every step checked.
import {
  DEFAULT_RULE_CONFIG,
  TEST_BRANCH_BOARD,
  TEST_LOOP_BOARD,
  actorOf,
  applyAction,
  checkInvariants,
  computerAction,
  createGame,
  createRng,
  legalActions,
  nextInt,
  viewFor,
  type Action,
  type ActionType,
  type Board,
  type Controller,
  type CreateGameError,
  type GameEndReason,
  type GameEvent,
  type GameSetup,
  type GameState,
  type PlayerId,
  type RuleError,
  type TileIndex,
  type Viewer,
} from '@richman/shared';

/** The engine functions the simulator calls; tests swap in broken ones. */
export interface Engine {
  createGame: typeof createGame;
  actorOf: typeof actorOf;
  applyAction: typeof applyAction;
  legalActions: typeof legalActions;
  computerAction: typeof computerAction;
  viewFor: typeof viewFor;
  checkInvariants: typeof checkInvariants;
}

export const ENGINE: Engine = {
  createGame,
  actorOf,
  applyAction,
  legalActions,
  computerAction,
  viewFor,
  checkInvariants,
};

export const PLAYER_COUNT = 4;

/**
 * Who plays the seats (a simulator setting, not a rule):
 * - random: random legal choices everywhere (every player marked human);
 * - computer: random choices in seat 1, the engine's computerAction in the others. Seat 1 is a human
 *   because a game with no human ends at its first bankruptcy (docs/GAME_RULES.md §1);
 * - mixed: computers in seats 2 and 4, random choices in seats 1 and 3.
 */
export const CONTROLLER_MODES = ['random', 'computer', 'mixed'] as const;

export type ControllerMode = (typeof CONTROLLER_MODES)[number];

export function isControllerMode(mode: unknown): mode is ControllerMode {
  return (CONTROLLER_MODES as readonly unknown[]).includes(mode);
}

export function controllersFor(mode: ControllerMode): Controller[] {
  return Array.from({ length: PLAYER_COUNT }, (_, seat): Controller => {
    switch (mode) {
      case 'random':
        return 'human';
      case 'computer':
        return seat === 0 ? 'human' : 'computer';
      case 'mixed':
        return seat % 2 === 1 ? 'computer' : 'human';
    }
  });
}

/**
 * Actions one auction may take before it counts as runaway bidding. Raises are at least 100 and
 * bounded by cash, so a real auction ends far sooner.
 */
export const MAX_AUCTION_ACTIONS = 5000;

/** Hidden state that must never appear in a view, as JSON keys. */
const HIDDEN_KEYS = ['rngState', 'queue', 'computerLimits', 'lotteryPool'] as const;

/** Built-in boards the simulator can play, by Board.id. */
export const BOARDS = {
  'test-loop': TEST_LOOP_BOARD,
  'test-branch': TEST_BRANCH_BOARD,
} as const satisfies Record<string, Board>;

export type BoardName = keyof typeof BOARDS;

export const BOARD_NAMES = Object.keys(BOARDS) as BoardName[];

export function isBoardName(name: unknown): name is BoardName {
  return typeof name === 'string' && Object.hasOwn(BOARDS, name);
}

/**
 * A well-formed example of every action type, for checking that unoffered types are refused. A
 * Record so adding an ActionType without listing it here is a type error.
 */
const EXAMPLE_ACTIONS: Record<ActionType, (playerId: PlayerId) => Action> = {
  rollDice: (playerId) => ({ type: 'rollDice', playerId }),
  buyProperty: (playerId) => ({ type: 'buyProperty', playerId }),
  upgradeProperty: (playerId) => ({ type: 'upgradeProperty', playerId }),
  decline: (playerId) => ({ type: 'decline', playerId }),
  bid: (playerId) => ({ type: 'bid', playerId, raise: DEFAULT_RULE_CONFIG.auctionRaises[0] ?? 1 }),
  passRound: (playerId) => ({ type: 'passRound', playerId }),
  withdraw: (playerId) => ({ type: 'withdraw', playerId }),
};

export interface GameSpec {
  board: BoardName;
  controllers: ControllerMode;
  seed: number;
  /** RuleConfig.dayLimit; null for no limit. */
  dayLimit: number | null;
  /** RuleConfig.netWorthTargetMultiple; null for no target. */
  netWorthTargetMultiple: number | null;
  /**
   * Simulator-only safety cap, not a rule: a game still going once this many days have gone by is
   * recorded as unfinished.
   */
  maxDays: number;
  /** Runaway guard: a game that needs more actions than this is a failure. */
  maxSteps: number;
}

export type EndReason = GameEndReason;

export type Failure =
  | { kind: 'createGame'; errors: CreateGameError[] }
  | { kind: 'invariant'; violations: string[] }
  /** The price index only rises (docs/GAME_RULES.md §3). */
  | { kind: 'priceIndexFell'; from: number; to: number }
  | { kind: 'noLegalActions'; playerId: PlayerId }
  /** Someone other than actorOf (the player the game waits for; nobody after game over) was offered actions. */
  | { kind: 'offeredOutOfTurn'; playerId: PlayerId; actions: Action[] }
  /** computerAction picked an unoffered action, nothing for a computer, or something for a human. */
  | { kind: 'computerActionNotLegal'; playerId: PlayerId; action: Action | null }
  /** A view sent hidden state (HIDDEN_KEYS). */
  | { kind: 'viewLeak'; viewer: string; key: string }
  | { kind: 'auctionTooLong'; tile: TileIndex; actions: number }
  | { kind: 'legalActionRejected'; action: Action; error: RuleError }
  /** An action type missing from legalActions was not refused with wrongPhase. */
  | { kind: 'unofferedNotRefused'; action: Action; outcome: string }
  | { kind: 'missingGameEnded' }
  | { kind: 'stepLimit'; maxSteps: number }
  | { kind: 'exception'; message: string; stack?: string };

export type Outcome =
  | { kind: 'finished'; reason: EndReason; winnerSeats: number[] }
  /** Still going after GameSpec.maxDays. */
  | { kind: 'unfinished' }
  /** `step` = number of actions applied before the failure was found. */
  | { kind: 'failed'; step: number; failure: Failure };

/** What one game looked like, for the run statistics (docs/ENGINE_REFACTOR_PLAN.md, question 4). */
export interface GameMetrics {
  /** null when nobody went bankrupt. */
  firstBankruptcyRound: number | null;
  finalDay: number;
  finalPriceIndex: number;
  /** The round in which the price index first went above 1; null if it never did. */
  priceIndexRiseRound: number | null;
  /** The lottery pool at the end: auction proceeds and system debts. */
  lotteryPool: number;
  /** Properties put up for auction. */
  auctions: number;
  auctionsWithBidders: number;
  auctionsSold: number;
  /** Sum of sale price ÷ start price over the properties sold. */
  saleRatioSum: number;
  /** Steps taken at a fork (more than one way on). */
  forks: number;
  /** Steps that turned back at a dead end. */
  deadEnds: number;
}

export function emptyMetrics(): GameMetrics {
  return {
    firstBankruptcyRound: null,
    finalDay: 0,
    finalPriceIndex: 1,
    priceIndexRiseRound: null,
    lotteryPool: 0,
    auctions: 0,
    auctionsWithBidders: 0,
    auctionsSold: 0,
    saleRatioSum: 0,
    forks: 0,
    deadEnds: 0,
  };
}

export interface GameRecord {
  seed: number;
  actions: Action[];
  rounds: number;
  bankruptcies: number;
  metrics: GameMetrics;
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

export function gameSetup(
  spec: Pick<GameSpec, 'board' | 'controllers' | 'seed' | 'dayLimit' | 'netWorthTargetMultiple'>,
): GameSetup {
  const controllers = controllersFor(spec.controllers);
  return {
    config: {
      ...DEFAULT_RULE_CONFIG,
      dayLimit: spec.dayLimit,
      netWorthTargetMultiple: spec.netWorthTargetMultiple,
    },
    board: BOARDS[spec.board],
    players: Array.from({ length: PLAYER_COUNT }, (_, i) => ({
      id: `p${i + 1}`,
      name: `AI ${i + 1}`,
      controller: controllers[i] ?? 'human',
    })),
    seed: spec.seed,
  };
}

/**
 * Checks one state before an action is chosen: the price index did not fall since the previous
 * state (null for the first), invariants hold, nobody but actorOf is
 * offered anything (nobody at all after game over), every offered action is accepted and every
 * other action type is refused with wrongPhase. May throw if the engine does.
 */
export function checkStep(
  engine: Engine,
  state: GameState,
  previous: GameState | null,
): Failure | null {
  if (previous !== null && state.priceIndex < previous.priceIndex) {
    return { kind: 'priceIndexFell', from: previous.priceIndex, to: state.priceIndex };
  }
  const violations = engine.checkInvariants(state);
  if (violations.length > 0) {
    return { kind: 'invariant', violations };
  }
  const viewers: Viewer[] = [
    ...state.players.map(({ id }): Viewer => ({ kind: 'player', id })),
    { kind: 'spectator' },
  ];
  for (const viewer of viewers) {
    // The board and config come from the setup and are the bulk of a view; skip them for speed.
    const json = JSON.stringify({ ...engine.viewFor(state, viewer), board: null, config: null });
    const key = HIDDEN_KEYS.find((k) => json.includes(`"${k}"`));
    if (key !== undefined) {
      return { kind: 'viewLeak', viewer: viewer.kind === 'player' ? viewer.id : 'spectator', key };
    }
  }
  const actor = engine.actorOf(state);
  for (const { id } of state.players) {
    if (id !== actor) {
      const offered = engine.legalActions(state, id);
      if (offered.length > 0) {
        return { kind: 'offeredOutOfTurn', playerId: id, actions: offered };
      }
    }
  }
  if (actor === null) {
    return null;
  }

  const legal = engine.legalActions(state, actor);
  if (legal.length === 0) {
    return { kind: 'noLegalActions', playerId: actor };
  }
  for (const action of legal) {
    const result = engine.applyAction(state, action);
    if (!result.ok) {
      return { kind: 'legalActionRejected', action, error: result.error };
    }
  }
  const computer = state.players.find((p) => p.id === actor)?.controller === 'computer';
  const picked = engine.computerAction(state, actor);
  const pickedLegal = picked !== null && legal.some((a) => sameAction(a, picked));
  if (computer ? !pickedLegal : picked !== null) {
    return { kind: 'computerActionNotLegal', playerId: actor, action: picked };
  }
  for (const [type, example] of Object.entries(EXAMPLE_ACTIONS)) {
    if (!legal.some((a) => a.type === type)) {
      const action = example(actor);
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

export const sameAction = (a: Action, b: Action): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

export function exceptionFailure(error: unknown): Failure {
  return error instanceof Error
    ? { kind: 'exception', message: error.message, ...(error.stack ? { stack: error.stack } : {}) }
    : { kind: 'exception', message: String(error) };
}

/**
 * Plays one game: computer seats through computerAction, the others with uniformly random legal
 * actions. Never throws: problems become failures.
 */
export function runGame(spec: GameSpec, engine: Engine = ENGINE): GameRecord {
  const actions: Action[] = [];
  let rounds = 0;
  let bankruptcies = 0;
  const metrics = emptyMetrics();
  const record = (outcome: Outcome): GameRecord => ({
    seed: spec.seed,
    actions,
    rounds,
    bankruptcies,
    metrics,
    outcome,
  });
  const fail = (failure: Failure) => record({ kind: 'failed', step: actions.length, failure });

  try {
    const created = engine.createGame(gameSetup(spec));
    if (!created.ok) {
      return fail({ kind: 'createGame', errors: created.errors });
    }
    let state = created.state;
    let previous: GameState | null = null;
    let chooser = createRng(chooserSeedFor(spec.seed));
    let ending: { reason: EndReason; winners: readonly PlayerId[] } | null = null;
    let auction: { tile: TileIndex; actions: number } | null = null;
    for (;;) {
      rounds = state.turn.round;
      Object.assign(metrics, {
        finalDay: state.day,
        finalPriceIndex: state.priceIndex,
        lotteryPool: state.lotteryPool,
      });
      if (metrics.priceIndexRiseRound === null && state.priceIndex > 1) {
        metrics.priceIndexRiseRound = state.turn.round;
      }
      const failure = checkStep(engine, state, previous);
      if (failure !== null) {
        return fail(failure);
      }
      if (state.turn.phase.kind === 'gameOver') {
        break;
      }
      if (state.day >= spec.maxDays) {
        return record({ kind: 'unfinished' });
      }
      if (actions.length >= spec.maxSteps) {
        return fail({ kind: 'stepLimit', maxSteps: spec.maxSteps });
      }
      if (auction !== null && auction.actions >= MAX_AUCTION_ACTIONS) {
        return fail({ kind: 'auctionTooLong', ...auction });
      }

      const actor = engine.actorOf(state) ?? '';
      let action = engine.computerAction(state, actor);
      if (action === null) {
        const legal = engine.legalActions(state, actor);
        const [pick, next] = nextInt(chooser, legal.length);
        chooser = next;
        action = legal[pick] ?? null;
        if (action === null) {
          throw new Error(`picked ${pick} of ${legal.length} actions`);
        }
      }
      const result = engine.applyAction(state, action);
      if (!result.ok) {
        return fail({ kind: 'legalActionRejected', action, error: result.error });
      }
      actions.push(action);
      if (auction !== null) auction.actions++;
      countTurns(state, result.events, metrics);
      for (const event of result.events) {
        switch (event.type) {
          case 'PlayerBankrupt':
            bankruptcies++;
            metrics.firstBankruptcyRound ??= state.turn.round;
            break;
          case 'AuctionStarted':
            metrics.auctions++;
            if (event.bidders.length > 0) metrics.auctionsWithBidders++;
            auction = { tile: event.tile, actions: 0 };
            break;
          case 'AuctionWon':
            metrics.auctionsSold++;
            metrics.saleRatioSum += event.price / startPriceOf(state, result.state, event.tile);
            auction = null;
            break;
          case 'AuctionUnsold':
            auction = null;
            break;
          case 'GameEnded':
            ending = { reason: event.reason, winners: event.winners };
            break;
          default:
            break;
        }
      }
      previous = state;
      state = result.state;
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

/** The start price of the auction that sold `tile`: the phase before or after the action has it. */
function startPriceOf(before: GameState, after: GameState, tile: TileIndex): number {
  for (const { phase } of [before.turn, after.turn]) {
    if (phase.kind === 'auction' && phase.tile === tile) return phase.startPrice;
  }
  throw new Error(`no auction of tile ${tile} around the sale`);
}

/**
 * Counts forks and dead-end turnarounds along every PlayerMoved path, starting from where the mover
 * stood before the action.
 */
function countTurns(before: GameState, events: readonly GameEvent[], metrics: GameMetrics): void {
  const at = new Map<PlayerId, { tile: TileIndex; prev: TileIndex }>();
  for (const { id, location } of before.players) {
    if (location.kind === 'onBoard') at.set(id, { tile: location.tile, prev: location.prev });
  }
  for (const event of events) {
    if (event.type !== 'PlayerMoved') continue;
    const where = at.get(event.playerId);
    if (where === undefined) continue;
    for (const to of event.path) {
      const ways = (before.board.tiles[where.tile]?.links ?? []).filter(
        (link) => link.blocked !== true && link.to !== where.prev,
      ).length;
      if (ways > 1) metrics.forks++;
      if (ways === 0) metrics.deadEnds++;
      where.prev = where.tile;
      where.tile = to;
    }
  }
}
