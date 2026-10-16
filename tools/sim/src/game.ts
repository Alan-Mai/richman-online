// One simulated game: random legal actions, with every step checked.
import {
  DEFAULT_RULE_CONFIG,
  PROVISIONAL_COMPUTER_PROFILE,
  TEST_BRANCH_BOARD,
  TEST_LOOP_BOARD,
  actionFor,
  actorOf,
  allows,
  drawCharacters,
  isAmountOption,
  type AmountOption,
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
  type PhaseKind,
  type Board,
  type Controller,
  type CreateGameError,
  type GameEndReason,
  type GameEvent,
  type GameEventType,
  type GameSetup,
  type GameState,
  type LegalAction,
  type PlayerId,
  type PlayerSetup,
  type CharacterProfile,
  type RuleError,
  type TileIndex,
  type Vehicle,
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
 * Who plays the seats (a simulator setting, not a rule). Seats are the program's indexes: seat 0
 * is the first player.
 * - random: random legal choices everywhere (every player marked human);
 * - computer: random choices in seat 0, the engine's computerAction in the others. Seat 0 is a human
 *   because a game with no human ends at its first bankruptcy (docs/GAME_RULES.md §1);
 * - mixed: computers in seats 1 and 3, random choices in seats 0 and 2.
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
const HIDDEN_KEYS = [
  'rngState',
  'queue',
  'computerLimits',
  'computerDiceCount',
  'lotteryPool',
  'profile',
] as const;

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
  setDiceCount: (playerId) => ({ type: 'setDiceCount', playerId, count: 1 }),
  buyProperty: (playerId) => ({ type: 'buyProperty', playerId }),
  upgradeProperty: (playerId) => ({ type: 'upgradeProperty', playerId }),
  decline: (playerId) => ({ type: 'decline', playerId }),
  bid: (playerId) => ({ type: 'bid', playerId, raise: DEFAULT_RULE_CONFIG.auctionRaises[0] ?? 1 }),
  passRound: (playerId) => ({ type: 'passRound', playerId }),
  withdraw: (playerId) => ({ type: 'withdraw', playerId }),
  bankTransfer: (playerId) => ({
    type: 'bankTransfer',
    playerId,
    direction: 'withdraw',
    amount: 1,
  }),
  leaveBank: (playerId) => ({ type: 'leaveBank', playerId }),
  borrow: (playerId) => ({ type: 'borrow', playerId, amount: 1 }),
  repay: (playerId) => ({ type: 'repay', playerId, amount: 1 }),
  leaveCounter: (playerId) => ({ type: 'leaveCounter', playerId }),
};

/**
 * Concrete actions to try for an offer: the action itself, or a range's 1, middle and max. The
 * range check in checkStep also tries max + 1.
 */
function samplesOf(option: LegalAction): Action[] {
  if (!isAmountOption(option)) return [option];
  const amounts = [...new Set([1, Math.ceil(option.max / 2), option.max])];
  return amounts.map((amount) => actionFor(option, amount));
}

/**
 * How applyAction must refuse max + 1 of a range: more than there is is insufficientFunds, except
 * repaying more than the loan, which the original cannot even type (invalidAction).
 */
function aboveRangeRefusal(state: GameState, option: AmountOption): RuleError['code'] {
  if (option.type !== 'repay') return 'insufficientFunds';
  const loan = state.players.find((p) => p.id === option.playerId)?.loan ?? 0;
  return option.max + 1 > loan ? 'invalidAction' : 'insufficientFunds';
}

export interface GameSpec {
  board: BoardName;
  controllers: ControllerMode;
  /** RuleConfig.startingVehicle. */
  vehicle: Vehicle;
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
  /** Character profiles from --tables for the computer seats; provisional profiles without. */
  characters?: CharacterPool;
}

/** The profiles read from a tables.json, and its path for the rerun command. */
export interface CharacterPool {
  path: string;
  profiles: readonly CharacterProfile[];
}

export type EndReason = GameEndReason;

export type Failure =
  | { kind: 'createGame'; errors: CreateGameError[] }
  | { kind: 'invariant'; violations: string[] }
  /** The price index only rises (docs/GAME_RULES.md §3). */
  | { kind: 'priceIndexFell'; from: number; to: number }
  | { kind: 'noLegalActions'; playerId: PlayerId }
  /** Someone other than actorOf (the player the game waits for; nobody after game over) was offered actions. */
  | { kind: 'offeredOutOfTurn'; playerId: PlayerId; actions: LegalAction[] }
  /** computerAction picked an unoffered action, nothing for a computer, or something for a human. */
  | { kind: 'computerActionNotLegal'; playerId: PlayerId; action: Action | null }
  /** A view sent hidden state (HIDDEN_KEYS). */
  | { kind: 'viewLeak'; viewer: string; key: string }
  | { kind: 'auctionTooLong'; tile: TileIndex; actions: number }
  | { kind: 'legalActionRejected'; action: Action; error: RuleError }
  /** An amount just above an offered range was not refused as insufficientFunds. */
  | { kind: 'rangeNotEnforced'; action: Action; outcome: string }
  /**
   * An action type missing from legalActions was not refused with the expected error; expected
   * 'offered' means the type is always offered in this phase, but was not.
   */
  | {
      kind: 'unofferedNotRefused';
      action: Action;
      outcome: string;
      expected: RuleError['code'] | 'offered';
    }
  /** A transfer or rebalance at a bank changed the player's cash + deposit. */
  | { kind: 'bankChangedTotal'; playerId: PlayerId; before: number; after: number }
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
  /** Rolls by how many dice were rolled: diceRolls[n] rolls of n dice. */
  diceRolls: Record<number, number>;
  /** Banks opened for humans, walking over them and stopping on them. */
  bankOpensPassing: number;
  bankOpensStopping: number;
  /** Human transfers at banks, with the amounts moved. */
  bankWithdrawals: number;
  bankWithdrawn: number;
  bankDeposits: number;
  bankDeposited: number;
  /** Banks a human left without moving money. */
  bankLeaves: number;
  /** Computer rebalances that changed something. */
  bankRebalances: number;
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
    diceRolls: {},
    bankOpensPassing: 0,
    bankOpensStopping: 0,
    bankWithdrawals: 0,
    bankWithdrawn: 0,
    bankDeposits: 0,
    bankDeposited: 0,
    bankLeaves: 0,
    bankRebalances: 0,
  };
}

/** Counts bank openings, transfers, leaves and rebalances from one action and its events. */
export function countBanks(action: Action, events: readonly GameEvent[], metrics: GameMetrics) {
  if (action.type === 'leaveBank') metrics.bankLeaves++;
  for (const event of events) {
    switch (event.type) {
      case 'BankOpened':
        if (event.trigger === 'pass') metrics.bankOpensPassing++;
        else metrics.bankOpensStopping++;
        break;
      case 'BankTransferred':
        if (event.direction === 'withdraw') {
          metrics.bankWithdrawals++;
          metrics.bankWithdrawn += event.amount;
        } else {
          metrics.bankDeposits++;
          metrics.bankDeposited += event.amount;
        }
        break;
      case 'BankRebalanced':
        metrics.bankRebalances++;
        break;
      default:
        break;
    }
  }
}

/** Events that move a player's money in or out, as opposed to between cash and deposit. */
const MONEY_EVENTS: ReadonlySet<GameEventType> = new Set<GameEventType>([
  'RentPaid',
  'PropertyBought',
  'PropertyUpgraded',
  'PlayerBankrupt',
  'AuctionWon',
  'LoanBorrowed',
  'LoanRepaid',
]);

/**
 * Moving money at a bank keeps cash + deposit (docs/BANK_PLAN.md 2-6), checked over one action
 * from the state before it. A rebalance carries the new amounts and comes before any payment in
 * the action, so it is always checked; a transfer carries only the amount, so it is checked
 * against the state after the action unless money went in or out for that player meanwhile.
 */
export function checkBankTotals(
  before: GameState,
  after: GameState,
  events: readonly GameEvent[],
): Failure | null {
  const totalIn = (state: GameState, id: PlayerId) => {
    const player = state.players.find((p) => p.id === id);
    return player === undefined ? NaN : player.cash + player.deposit;
  };
  const touched = new Set<PlayerId>();
  const transferred = new Set<PlayerId>();
  for (const event of events) {
    if (MONEY_EVENTS.has(event.type)) {
      for (const value of Object.values(event)) {
        if (typeof value === 'string') touched.add(value);
      }
    } else if (event.type === 'BankTransferred') {
      transferred.add(event.playerId);
    } else if (event.type === 'BankRebalanced' && !touched.has(event.playerId)) {
      const total = totalIn(before, event.playerId);
      if (event.cash + event.deposit !== total) {
        const { playerId } = event;
        return {
          kind: 'bankChangedTotal',
          playerId,
          before: total,
          after: event.cash + event.deposit,
        };
      }
    }
  }
  for (const playerId of transferred) {
    const [was, is] = [totalIn(before, playerId), totalIn(after, playerId)];
    if (!touched.has(playerId) && was !== is) {
      return { kind: 'bankChangedTotal', playerId, before: was, after: is };
    }
  }
  return null;
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
  spec: Pick<
    GameSpec,
    | 'board'
    | 'controllers'
    | 'vehicle'
    | 'seed'
    | 'dayLimit'
    | 'netWorthTargetMultiple'
    | 'characters'
  >,
): GameSetup {
  const controllers = controllersFor(spec.controllers);
  const seats = Array.from({ length: PLAYER_COUNT }, (_, i) => controllers[i] ?? 'human');
  const computers = seats.filter((c) => c === 'computer').length;
  const pool = spec.characters?.profiles;
  const profiles =
    pool === undefined
      ? Array.from({ length: computers }, () => PROVISIONAL_COMPUTER_PROFILE)
      : drawCharacters(pool.length, computers, spec.seed).map((i) => pool[i]);
  let nextProfile = 0;
  return {
    config: {
      ...DEFAULT_RULE_CONFIG,
      startingVehicle: spec.vehicle,
      dayLimit: spec.dayLimit,
      netWorthTargetMultiple: spec.netWorthTargetMultiple,
    },
    board: BOARDS[spec.board],
    players: seats.map((controller, i): PlayerSetup => {
      const base = { id: `p${i + 1}`, name: `AI ${i + 1}` };
      if (controller !== 'computer') {
        return { ...base, controller };
      }
      const profile = profiles[nextProfile++];
      if (profile === undefined) {
        throw new Error(`no profile for computer seat ${i}`);
      }
      return { ...base, controller, profile };
    }),
    seed: spec.seed,
  };
}

/**
 * Checks one state before an action is chosen: the price index did not fall since the previous
 * state (null for the first), invariants hold, nobody but actorOf is
 * offered anything (nobody at all after game over), every offered action is accepted and every
 * other action type is refused (see expectedRefusal). May throw if the engine does.
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
  for (const option of legal) {
    for (const action of samplesOf(option)) {
      const result = engine.applyAction(state, action);
      if (!result.ok) {
        return { kind: 'legalActionRejected', action, error: result.error };
      }
    }
    if (isAmountOption(option)) {
      const action = actionFor(option, option.max + 1);
      const result = engine.applyAction(state, action);
      if (result.ok || result.error.code !== aboveRangeRefusal(state, option)) {
        return {
          kind: 'rangeNotEnforced',
          action,
          outcome: result.ok ? 'accepted' : result.error.code,
        };
      }
    }
  }
  const computer = state.players.find((p) => p.id === actor)?.controller === 'computer';
  const picked = engine.computerAction(state, actor);
  const pickedLegal = picked !== null && legal.some((option) => allows(option, picked));
  if (computer ? !pickedLegal : picked !== null) {
    return { kind: 'computerActionNotLegal', playerId: actor, action: picked };
  }
  for (const [type, example] of Object.entries(EXAMPLE_ACTIONS)) {
    if (!legal.some((a) => a.type === type)) {
      const action = example(actor);
      const result = engine.applyAction(state, action);
      const expected = expectedRefusal(state, action.type);
      if (result.ok || result.error.code !== expected) {
        return {
          kind: 'unofferedNotRefused',
          action,
          outcome: result.ok ? 'accepted' : result.error.code,
          expected,
        };
      }
    }
  }
  return null;
}

/** The action types each phase handles; applyAction refuses any other type as wrongPhase. */
const PHASE_ACTIONS: Readonly<Record<PhaseKind, readonly ActionType[]>> = {
  awaitRoll: ['rollDice', 'setDiceCount'],
  awaitBuyDecision: ['buyProperty', 'decline'],
  awaitUpgradeDecision: ['upgradeProperty', 'decline'],
  auction: ['bid', 'passRound', 'withdraw'],
  bank: ['bankTransfer', 'leaveBank'],
  bankCounter: ['borrow', 'repay', 'leaveCounter'],
  gameOver: [],
};

/**
 * How an unoffered action type must be refused, following the error order in
 * docs/ARCHITECTURE.md: wrongPhase if the phase does not handle the type; otherwise the action's own
 * check, which is why it was not offered: no dice choice on foot (invalidAction), cash short of the
 * smallest raise, nothing to move at a bank or nothing more to borrow (insufficientFunds), no loan
 * to repay (invalidAction) or nothing to repay it with (insufficientFunds). The other types are
 * always offered in their phases ('offered').
 */
function expectedRefusal(state: GameState, type: ActionType): RuleError['code'] | 'offered' {
  if (!PHASE_ACTIONS[state.turn.phase.kind].includes(type)) {
    return 'wrongPhase';
  }
  switch (type) {
    case 'setDiceCount':
      return 'invalidAction';
    case 'bid':
    case 'bankTransfer':
    case 'borrow':
      return 'insufficientFunds';
    case 'repay': {
      const loan = state.players.find((p) => p.id === state.turn.current)?.loan ?? 0;
      return loan === 0 ? 'invalidAction' : 'insufficientFunds';
    }
    default:
      return 'offered';
  }
}

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
        const option = legal[pick];
        if (option === undefined) {
          throw new Error(`picked ${pick} of ${legal.length} actions`);
        }
        if (isAmountOption(option)) {
          // Any amount in the range, uniformly.
          const [amount, after] = nextInt(chooser, option.max);
          chooser = after;
          action = actionFor(option, amount + 1);
        } else {
          action = option;
        }
      }
      const result = engine.applyAction(state, action);
      if (!result.ok) {
        return fail({ kind: 'legalActionRejected', action, error: result.error });
      }
      // Like replay: the step is the action's index, and the log keeps the action.
      const bankFailure = checkBankTotals(state, result.state, result.events);
      const failed = bankFailure === null ? null : fail(bankFailure);
      actions.push(action);
      if (failed !== null) {
        return failed;
      }
      if (auction !== null) auction.actions++;
      countTurns(state, result.events, metrics);
      countDice(result.events, metrics);
      countBanks(action, result.events, metrics);
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

function countDice(events: readonly GameEvent[], metrics: GameMetrics): void {
  for (const event of events) {
    if (event.type !== 'DiceRolled') continue;
    const n = event.dice.length;
    metrics.diceRolls[n] = (metrics.diceRolls[n] ?? 0) + 1;
  }
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
