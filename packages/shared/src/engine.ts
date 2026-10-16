// State transitions of the rule engine. Pure and deterministic: randomness only comes from
// state.rngState (see CLAUDE.md and .claude/rules/shared-engine.md).
import {
  BANK_DIRECTIONS,
  type Action,
  type ActionType,
  type BankDirection,
  type LegalAction,
} from './actions';
import { applyAuctionAction, auctionActions, startAuctions, type AuctionStep } from './auction';
import { computerBid, drawComputerDiceCount } from './computer';
import { isPlaceable, validateBoard, type Board, type BoardError } from './board';
import { nextDay } from './calendar';
import { validateRuleConfig, type RuleConfig, type RuleConfigError } from './config';
import type { RuleError } from './errors';
import type { GameEndReason, GameEvent } from './events';
import type { PlayerId, TileIndex } from './ids';
import { stepFrom } from './movement';
import { isValidProfile, openingSplit, type CharacterProfile } from './profile';
import { createRng, isUint32, nextInt, type RngState } from './rng';
import { buyPrice, netWorth, pay, rentFor, spend, spendable, upgradeCost } from './money';
import type { BankTrigger, Controller, GameState, Phase, PhaseKind, PlayerState } from './state';
import { at, chain, findPlayer, playerOf, updatePlayer, updateTile, type Step } from './update';

type BankPhase = Extract<Phase, { kind: 'bank' }>;
type BuyDecision = Extract<Phase, { kind: 'awaitBuyDecision' }>;
type UpgradeDecision = Extract<Phase, { kind: 'awaitUpgradeDecision' }>;

interface PlayerSetupBase {
  id: PlayerId;
  name: string;
}

/** One seat. Computer seats carry their character's profile, picked by the caller. */
export type PlayerSetup =
  | (PlayerSetupBase & { controller: 'human' })
  | (PlayerSetupBase & { controller: 'computer'; profile: CharacterProfile });

export interface GameSetup {
  config: RuleConfig;
  board: Board;
  /** Seat order. */
  players: readonly PlayerSetup[];
  /** uint32; anything else (including RNG state objects) is rejected. */
  seed: number;
}

export type CreateGameError =
  | { reason: 'config'; error: RuleConfigError }
  | { reason: 'board'; error: BoardError }
  | { reason: 'playerCount'; count: number }
  | { reason: 'emptyPlayerId'; seat: number }
  | { reason: 'duplicatePlayerId'; playerId: PlayerId }
  | { reason: 'invalidController'; seat: number }
  /** A computer seat without a valid profile (isValidProfile). */
  | { reason: 'invalidProfile'; seat: number }
  | { reason: 'invalidSeed' };

export type CreateGameResult =
  { ok: true; state: GameState; events: GameEvent[] } | { ok: false; errors: CreateGameError[] };

const CONTROLLERS: ReadonlySet<string> = new Set<Controller>(['human', 'computer']);

function validateSetup(setup: GameSetup): CreateGameError[] {
  const { config, board, players, seed } = setup;
  const errors: CreateGameError[] = [
    ...validateRuleConfig(config).map((error) => ({ reason: 'config' as const, error })),
    ...validateBoard(board, config).map((error) => ({ reason: 'board' as const, error })),
  ];

  if (players.length < config.minPlayers || players.length > config.maxPlayers) {
    errors.push({ reason: 'playerCount', count: players.length });
  }
  const seen = new Set<PlayerId>();
  players.forEach((player, seat) => {
    const { id, controller } = player;
    if (!CONTROLLERS.has(controller)) {
      errors.push({ reason: 'invalidController', seat });
    } else if (controller === 'computer' && !isValidProfile(player.profile)) {
      errors.push({ reason: 'invalidProfile', seat });
    }
    if (id === '') {
      errors.push({ reason: 'emptyPlayerId', seat });
    } else if (seen.has(id)) {
      errors.push({ reason: 'duplicatePlayerId', playerId: id });
    }
    seen.add(id);
  });

  if (!isUint32(seed)) {
    errors.push({ reason: 'invalidSeed' });
  }
  return errors;
}

/**
 * Validates the setup and deals the opening state; seat 0 moves first. Everyone starts off the
 * board; seat 0 is placed right away as its first turn starts, the others when theirs do.
 */
export function createGame(setup: GameSetup): CreateGameResult {
  const errors = validateSetup(setup);
  const first = setup.players[0];
  if (errors.length > 0 || first === undefined) {
    return { ok: false, errors };
  }

  const { config, board } = setup;
  // Humans get half each as cash and deposit, an odd one going to neither; computers split by
  // their profile (docs/GAME_RULES.md §1).
  const dealt = Math.floor(config.startingFunds / 2);
  const players = setup.players.map((player): PlayerState => ({
    id: player.id,
    name: player.name,
    controller: player.controller,
    ...(player.controller === 'computer'
      ? {
          profile: {
            cashPercent: player.profile.cashPercent,
            loanPercent: player.profile.loanPercent,
          },
          ...openingSplit(config.startingFunds, player.profile),
        }
      : { profile: null, cash: dealt, deposit: dealt }),
    points: config.startingPoints,
    location: { kind: 'offBoard' },
    // Everyone rides the starting vehicle with its most dice (docs/GAME_RULES.md §9). Taking one
    // from the shop stock per player comes with the stock itself (Phase 5).
    vehicle: config.startingVehicle,
    diceCount: config.vehicleMaxDice[config.startingVehicle],
    bankrupt: false,
  }));
  const state: GameState = {
    config,
    board,
    players,
    tiles: board.tiles.map(() => ({ owner: null, level: 0 })),
    turn: { current: first.id, round: 1, phase: { kind: 'awaitRoll' } },
    day: 0,
    date: { ...config.startDate },
    priceIndex: 1,
    lotteryPool: 0,
    rngState: createRng(setup.seed),
  };
  const started = startTurn(state, first.id, 1);
  return { ok: true, state: started.state, events: started.events };
}

export type Result =
  { ok: true; state: GameState; events: GameEvent[] } | { ok: false; error: RuleError };

const ACTION_TYPES: ReadonlySet<string> = new Set<ActionType>([
  'rollDice',
  'setDiceCount',
  'buyProperty',
  'upgradeProperty',
  'decline',
  'bid',
  'passRound',
  'withdraw',
  'bankTransfer',
  'leaveBank',
]);

const BANK_DIRECTION_SET: ReadonlySet<unknown> = new Set(BANK_DIRECTIONS);

/** Actions arrive from the network; rebuild a clean Action or reject the shape. */
function parseAction(raw: unknown): Action | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return null;
  }
  const { type, playerId, raise, count, direction, amount } = raw as Record<string, unknown>;
  if (typeof type !== 'string' || !ACTION_TYPES.has(type) || typeof playerId !== 'string') {
    return null;
  }
  const actionType = type as ActionType;
  switch (actionType) {
    case 'bid':
      return Number.isSafeInteger(raise)
        ? { type: actionType, playerId, raise: raise as number }
        : null;
    case 'setDiceCount':
      return Number.isSafeInteger(count)
        ? { type: actionType, playerId, count: count as number }
        : null;
    case 'rollDice':
    case 'buyProperty':
    case 'upgradeProperty':
    case 'decline':
    case 'passRound':
    case 'withdraw':
      return { type: actionType, playerId };
    case 'bankTransfer':
      return BANK_DIRECTION_SET.has(direction) && Number.isSafeInteger(amount)
        ? {
            type: actionType,
            playerId,
            direction: direction as BankDirection,
            amount: amount as number,
          }
        : null;
    case 'leaveBank':
      return { type: actionType, playerId };
  }
}

function reject(error: RuleError): Result {
  return { ok: false, error };
}

function wrongPhase(phase: PhaseKind): Result {
  return reject({ code: 'wrongPhase', phase });
}

function accept({ state, events }: Step): Result {
  return { ok: true, state, events };
}

/**
 * Applies one player intent. Malformed or illegal actions are rejected without changing anything;
 * the input state is never mutated.
 */
export function applyAction(state: GameState, rawAction: Action): Result {
  const action = parseAction(rawAction);
  if (action === null) {
    return reject({ code: 'invalidAction' });
  }
  const { phase } = state.turn;
  if (phase.kind === 'gameOver') {
    return reject({ code: 'gameOver' });
  }
  if (findPlayer(state, action.playerId) === undefined) {
    return reject({ code: 'unknownPlayer' });
  }
  if (action.playerId !== actorOf(state)) {
    return reject({ code: 'notYourTurn' });
  }

  switch (action.type) {
    case 'rollDice':
      return phase.kind === 'awaitRoll' ? accept(rollDice(state)) : wrongPhase(phase.kind);
    case 'setDiceCount':
      return phase.kind === 'awaitRoll'
        ? setDiceCount(state, action.count)
        : wrongPhase(phase.kind);
    case 'buyProperty':
      return phase.kind === 'awaitBuyDecision' ? buyProperty(state, phase) : wrongPhase(phase.kind);
    case 'upgradeProperty':
      return phase.kind === 'awaitUpgradeDecision'
        ? upgradeProperty(state, phase)
        : wrongPhase(phase.kind);
    case 'decline':
      return phase.kind === 'awaitBuyDecision' || phase.kind === 'awaitUpgradeDecision'
        ? accept(endTurn(state))
        : wrongPhase(phase.kind);
    case 'bid':
    case 'passRound':
    case 'withdraw': {
      if (phase.kind !== 'auction') {
        return wrongPhase(phase.kind);
      }
      const result = applyAuctionAction(state, phase, action);
      return result.ok ? accept(afterAuctionStep(result.step)) : reject(result.error);
    }
    case 'bankTransfer':
      return phase.kind === 'bank'
        ? bankTransfer(state, phase, action.direction, action.amount)
        : wrongPhase(phase.kind);
    case 'leaveBank':
      return phase.kind === 'bank' ? accept(closeBank(state, phase)) : wrongPhase(phase.kind);
  }
}

/**
 * Who the game is waiting for, or null once it is over. Usually turn.current; during an auction
 * (docs/GAME_RULES.md §8) the bidder whose turn it is. Only one player acts at a time.
 */
export function actorOf(state: GameState): PlayerId | null {
  const { phase } = state.turn;
  switch (phase.kind) {
    case 'gameOver':
      return null;
    case 'auction':
      return phase.bidder;
    default:
      return state.turn.current;
  }
}

/**
 * Server and simulator only: what the computer player playerId does now, or null when the game is
 * not waiting for them or they are not a computer. Always one of legalActions(state, playerId).
 * Buying and building use a provisional, non-original rule: whenever offered (and so affordable).
 */
export function computerAction(state: GameState, playerId: PlayerId): Action | null {
  const player = findPlayer(state, playerId);
  if (player?.controller !== 'computer' || actorOf(state) !== playerId) {
    return null;
  }
  const { phase } = state.turn;
  switch (phase.kind) {
    case 'awaitRoll': {
      const count = phase.computerDiceCount;
      return count === undefined || count === player.diceCount
        ? { type: 'rollDice', playerId }
        : { type: 'setDiceCount', playerId, count };
    }
    case 'awaitBuyDecision':
      return { type: 'buyProperty', playerId };
    case 'awaitUpgradeDecision':
      return { type: 'upgradeProperty', playerId };
    case 'auction':
      return computerBid(state, phase);
    case 'bank':
      // Computers move money by themselves and never open a bank; this is for Phase 4 stand-ins
      // playing a human seat, whose behaviour there is still to be decided (ROADMAP Phase 4).
      return { type: 'leaveBank', playerId };
    case 'gameOver':
      return null;
  }
}

/**
 * Server-only: what playerId may send now, as exact actions or ranges (LegalAction; check an
 * action against them with allows). Empty unless it is their turn.
 */
export function legalActions(state: GameState, playerId: PlayerId): LegalAction[] {
  if (playerId !== actorOf(state)) {
    return [];
  }
  switch (state.turn.phase.kind) {
    case 'awaitRoll': {
      const most = choosableDice(state) ?? 0;
      const counts = Array.from({ length: most }, (_, i) => i + 1);
      return [
        { type: 'rollDice', playerId },
        ...counts.map((count): LegalAction => ({ type: 'setDiceCount', playerId, count })),
      ];
    }
    case 'awaitBuyDecision':
      return [
        { type: 'buyProperty', playerId },
        { type: 'decline', playerId },
      ];
    case 'awaitUpgradeDecision':
      return [
        { type: 'upgradeProperty', playerId },
        { type: 'decline', playerId },
      ];
    case 'auction':
      return auctionActions(state, state.turn.phase);
    case 'bank': {
      // Withdrawing first, like the original's default mode (docs/GAME_RULES.md §4).
      const { cash, deposit } = playerOf(state, playerId);
      const transfers: [BankDirection, number][] = [
        ['withdraw', deposit],
        ['deposit', cash],
      ];
      return [
        ...transfers.flatMap(([direction, max]): LegalAction[] =>
          max > 0 ? [{ type: 'bankTransfer', playerId, direction, max }] : [],
        ),
        { type: 'leaveBank', playerId },
      ];
    }
    case 'gameOver':
      return [];
  }
}

/**
 * The most dice the current player may choose to roll, or null when their vehicle gives no choice:
 * on foot (docs/GAME_RULES.md §9).
 */
function choosableDice(state: GameState): number | null {
  const { vehicle } = playerOf(state, state.turn.current);
  return vehicle === 'walk' ? null : state.config.vehicleMaxDice[vehicle];
}

function setDiceCount(state: GameState, count: number): Result {
  const most = choosableDice(state);
  if (most === null || count < 1 || count > most) {
    return reject({ code: 'invalidAction' });
  }
  const playerId = state.turn.current;
  return accept({
    state: updatePlayer(state, playerId, () => ({ diceCount: count })),
    events: [{ type: 'DiceCountSet', playerId, count }],
  });
}

function buyProperty(state: GameState, phase: BuyDecision): Result {
  const playerId = state.turn.current;
  if (spendable(playerOf(state, playerId)) < phase.price) {
    return reject({ code: 'insufficientFunds' });
  }
  const paid = spend(state, playerId, phase.price);
  const bought: Step = {
    state: updateTile(paid.state, phase.tile, { owner: playerId }),
    events: [
      ...paid.events,
      { type: 'PropertyBought', playerId, tile: phase.tile, price: phase.price },
    ],
  };
  return accept(chain(bought, endTurn));
}

function upgradeProperty(state: GameState, phase: UpgradeDecision): Result {
  const playerId = state.turn.current;
  if (spendable(playerOf(state, playerId)) < phase.cost) {
    return reject({ code: 'insufficientFunds' });
  }
  const paid = spend(state, playerId, phase.cost);
  const level = at(paid.state.tiles, phase.tile).level + 1;
  const upgraded: Step = {
    state: updateTile(paid.state, phase.tile, { level }),
    events: [
      ...paid.events,
      { type: 'PropertyUpgraded', playerId, tile: phase.tile, level, cost: phase.cost },
    ],
  };
  return accept(chain(upgraded, endTurn));
}

function rollDice(state: GameState): Step {
  const player = playerOf(state, state.turn.current);
  let rng: RngState = state.rngState;
  const dice: number[] = [];
  for (let i = 0; i < player.diceCount; i++) {
    const [value, next] = nextInt(rng, state.config.diceFaces);
    dice.push(value + 1);
    rng = next;
  }
  const total = dice.reduce((sum, face) => sum + face, 0);

  const rolled: Step = {
    state: { ...state, rngState: rng },
    events: [{ type: 'DiceRolled', playerId: player.id, dice, total }],
  };
  return chain(rolled, (s) => walk(s, player.id, total));
}

/**
 * Walks `steps` tiles from where the player stands, then lands. Every tile passed (not the landing
 * tile) gets its pass trigger; when one does something, the PlayerMoved path is split there so the
 * client can play the effect at the right spot. A human passing a bank stops there to decide
 * (phase bank) and walks the rest once done (closeBank).
 */
function walk(state: GameState, playerId: PlayerId, steps: number): Step {
  let current = state;
  const events: GameEvent[] = [];
  let segment: TileIndex[] = [];
  let { tile, prev } = boardLocation(playerOf(state, playerId));
  const standHere = (s: GameState) =>
    updatePlayer(s, playerId, () => ({ location: { kind: 'onBoard', tile, prev } }));
  for (let step = 1; step <= steps; step++) {
    const next = stepFrom(state.board, tile, prev, current.rngState);
    current = { ...current, rngState: next.rng };
    prev = tile;
    tile = next.to;
    segment.push(tile);
    if (step === steps) {
      break;
    }
    if (opensBank(current, playerId, tile)) {
      events.push({ type: 'PlayerMoved', playerId, path: segment });
      const trigger = { kind: 'pass', stepsLeft: steps - step } as const;
      return chain({ state: standHere(current), events }, (s) => openBank(s, tile, trigger));
    }
    const passed = resolvePass(current);
    if (passed.events.length > 0) {
      events.push({ type: 'PlayerMoved', playerId, path: segment }, ...passed.events);
      segment = [];
      current = passed.state;
    }
  }
  if (segment.length > 0) {
    events.push({ type: 'PlayerMoved', playerId, path: segment });
  }
  return chain({ state: standHere(current), events }, resolveLanding);
}

/**
 * Effect of walking over a tile without stopping, other than a human's bank (walk). None yet;
 * computers rebalancing at a bank comes next (docs/BANK_PLAN.md 2-5), road blocks in Phase 5.
 */
function resolvePass(state: GameState): Step {
  return { state, events: [] };
}

/**
 * Whether reaching this tile opens a bank for the player: a human on a bank (docs/GAME_RULES.md
 * §4). Computers move their money by themselves instead.
 */
function opensBank(state: GameState, playerId: PlayerId, tile: TileIndex): boolean {
  return (
    at(state.board.tiles, tile).kind === 'bank' && playerOf(state, playerId).controller === 'human'
  );
}

function openBank(state: GameState, tile: TileIndex, trigger: BankTrigger): Step {
  const playerId = state.turn.current;
  return {
    state: { ...state, turn: { ...state.turn, phase: { kind: 'bank', tile, trigger } } },
    events: [{ type: 'BankOpened', playerId, tile, trigger: trigger.kind }],
  };
}

/** One transfer per visit, then the bank closes (docs/GAME_RULES.md §4). */
function bankTransfer(
  state: GameState,
  phase: BankPhase,
  direction: BankDirection,
  amount: number,
): Result {
  const playerId = state.turn.current;
  const { cash, deposit } = playerOf(state, playerId);
  const moved = direction === 'withdraw' ? amount : -amount;
  if (amount < 1) {
    return reject({ code: 'invalidAction' });
  }
  if (cash + moved < 0 || deposit - moved < 0) {
    return reject({ code: 'insufficientFunds' });
  }
  const transferred: Step = {
    state: updatePlayer(state, playerId, (p) => ({
      cash: p.cash + moved,
      deposit: p.deposit - moved,
    })),
    events: [{ type: 'BankTransferred', playerId, direction, amount }],
  };
  return accept(chain(transferred, (s) => closeBank(s, phase)));
}

/** Walks the rest of the roll after a bank on the way, or ends the turn after stopping on one. */
function closeBank(state: GameState, phase: BankPhase): Step {
  return phase.trigger.kind === 'pass'
    ? walk(state, state.turn.current, phase.trigger.stepsLeft)
    : endTurn(state);
}

/** Effect of stopping on the current player's tile. */
function resolveLanding(state: GameState): Step {
  const { config } = state;
  const player = playerOf(state, state.turn.current);
  const index = boardLocation(player).tile;
  const tile = at(state.board.tiles, index);
  if (opensBank(state, player.id, index)) {
    return openBank(state, index, { kind: 'land' });
  }
  if (tile.kind !== 'property') {
    return endTurn(state);
  }

  const { owner, level } = at(state.tiles, index);
  const funds = spendable(player);
  if (owner === null) {
    const price = buyPrice(state, index);
    if (funds >= price) {
      return awaitDecision(state, { kind: 'awaitBuyDecision', tile: index, price });
    }
  } else if (owner === player.id) {
    const cost = upgradeCost(state, index);
    if (level < config.maxLevel && funds >= cost) {
      return awaitDecision(state, { kind: 'awaitUpgradeDecision', tile: index, cost });
    }
  } else {
    const amount = rentFor(state, index);
    const paid = pay(state, player.id, { kind: 'rent', tile: index, creditor: owner, amount });
    if (paid.bankrupt) {
      return chain(paid, (s) => afterBankruptcy(s, paid.releasedTiles));
    }
    const rent: GameEvent = {
      type: 'RentPaid',
      from: player.id,
      to: owner,
      tile: index,
      amount,
      into: 'deposit',
    };
    return chain({ state: paid.state, events: [...paid.events, rent] }, endTurn);
  }
  return endTurn(state);
}

/**
 * The current player has just gone bankrupt (docs/GAME_RULES.md §8). The game ends at once, without
 * auctions, if that was the only human seat, if no human is left, or if one player is left. If it
 * goes on, some of the released properties may be auctioned before the turn ends; the bankrupt
 * player stays turn.current meanwhile.
 */
function afterBankruptcy(state: GameState, released: readonly TileIndex[]): Step {
  // Checked in the original's order, before the last player standing (docs/GAME_RULES.md §1).
  const humanSeats = state.players.filter((p) => p.controller === 'human');
  const debtor = playerOf(state, state.turn.current);
  if (humanSeats.length === 1 && debtor.controller === 'human') {
    return endGame(state, 'humanBankrupt', []);
  }
  if (!state.players.some((p) => p.controller === 'human' && !p.bankrupt)) {
    return endGame(state, 'noHumansLeft', []);
  }
  if (state.players.filter((p) => !p.bankrupt).length <= 1) {
    return endTurn(state);
  }
  return afterAuctionStep(startAuctions(state, released));
}

function afterAuctionStep(step: AuctionStep): Step {
  const { state, events } = step;
  return step.done ? chain({ state, events }, endTurn) : { state, events };
}

function awaitDecision(state: GameState, phase: Phase): Step {
  return { state: { ...state, turn: { ...state.turn, phase } }, events: [] };
}

/**
 * Ends the current turn (docs/GAME_RULES.md §1): with at most one player left the game is over;
 * otherwise the next player who is not bankrupt moves. Wrapping past the last seat closes the round:
 * a day goes by, which may end the game, before the next round starts.
 */
function endTurn(state: GameState): Step {
  const { players } = state;
  const standing = players.filter((p) => !p.bankrupt);
  if (standing.length <= 1) {
    return endGame(
      state,
      'lastStanding',
      standing.map((p) => p.id),
    );
  }

  const seat = players.findIndex((p) => p.id === state.turn.current);
  let nextSeat = seat;
  for (let offset = 1; offset <= players.length; offset++) {
    const candidate = (seat + offset) % players.length;
    if (!at(players, candidate).bankrupt) {
      nextSeat = candidate;
      break;
    }
  }
  const wrapped = nextSeat <= seat;
  const next = at(players, nextSeat).id;
  if (!wrapped) {
    return startTurn(state, next, state.turn.round);
  }
  return chain(advanceDay(state), (s) =>
    s.turn.phase.kind === 'gameOver'
      ? { state: s, events: [] }
      : startTurn(s, next, s.turn.round + 1),
  );
}

/**
 * One day goes by at the end of every round (docs/GAME_RULES.md §2): the calendar date moves on
 * first, then the day limit and the net worth target are checked (docs/GAME_RULES.md §1); if the
 * game goes on, the price index becomes floor(average net worth of the players still in / starting
 * funds) unless that is lower (docs/GAME_RULES.md §3).
 */
function advanceDay(state: GameState): Step {
  const { config } = state;
  const day = state.day + 1;
  const { date } = nextDay(state.date);
  const standing = state.players.filter((p) => !p.bankrupt);
  const worths = standing.map((p) => netWorth(state, p.id));

  // The first (lowest seat) of the richest wins alone.
  const best = Math.max(...worths);
  const richest = at(standing, worths.indexOf(best)).id;
  const targetReached =
    config.netWorthTargetMultiple !== null &&
    best >= config.netWorthTargetMultiple * config.startingFunds;
  const dayLimitReached = config.dayLimit !== null && day >= config.dayLimit && best > 0;
  if (targetReached || dayLimitReached) {
    const dated: Step = {
      state: { ...state, day, date },
      events: [{ type: 'DayAdvanced', day, date, priceIndex: state.priceIndex }],
    };
    // The original takes the same path for both conditions and records neither.
    return chain(dated, (s) => endGame(s, 'dayLimitOrNetWorthTarget', [richest]));
  }

  const sum = worths.reduce((total, worth) => total + worth, 0);
  const average = Math.floor(sum / standing.length);
  const priceIndex = Math.max(state.priceIndex, Math.floor(average / config.startingFunds));
  return {
    state: { ...state, day, date, priceIndex },
    events: [{ type: 'DayAdvanced', day, date, priceIndex }],
  };
}

/** Hands the turn to playerId, placing them on the board first if this is their first turn. */
function startTurn(state: GameState, playerId: PlayerId, round: number): Step {
  const started: Step = {
    state: { ...state, turn: { current: playerId, round, phase: { kind: 'awaitRoll' } } },
    events: [{ type: 'TurnStarted', playerId, round }],
  };
  return chain(
    chain(started, (s) => placeIfOffBoard(s, playerId)),
    (s) => planComputerDice(s, playerId),
  );
}

/**
 * A computer on a motorbike or car picks its dice count as its turn starts, once it is on the
 * board (docs/GAME_RULES.md §9); computerAction then sets it before rolling.
 */
function planComputerDice(state: GameState, playerId: PlayerId): Step {
  if (playerOf(state, playerId).controller !== 'computer') {
    return { state, events: [] };
  }
  const drawn = drawComputerDiceCount(state, playerId);
  if (drawn === null) {
    return { state, events: [] };
  }
  const phase: Phase = { kind: 'awaitRoll', computerDiceCount: drawn.count };
  return { state: { ...state, rngState: drawn.rng, turn: { ...state.turn, phase } }, events: [] };
}

/**
 * First-turn placement (docs/GAME_RULES.md §1): a random placeable tile where no one in the game
 * stands, facing away from a random neighbour (blocked or not). validateBoard guarantees enough
 * placeable tiles, so running out is an engine bug, not a rule case.
 */
function placeIfOffBoard(state: GameState, playerId: PlayerId): Step {
  if (playerOf(state, playerId).location.kind === 'onBoard') {
    return { state, events: [] };
  }
  // Bankrupt players still hold the tile they went bankrupt on (docs/GAME_RULES.md §1).
  const occupied = new Set(
    state.players.flatMap((p) => (p.location.kind === 'onBoard' ? [p.location.tile] : [])),
  );
  const candidates = state.board.tiles.flatMap((tile, i) =>
    isPlaceable(tile) && !occupied.has(i) ? [i] : [],
  );
  if (candidates.length === 0) {
    throw new Error(`no tile to place ${playerId}`);
  }
  const placed = pickOne(candidates, state.rngState);
  const facing = pickOne(
    at(state.board.tiles, placed.item).links.map((link) => link.to),
    placed.rng,
  );
  const location = { kind: 'onBoard', tile: placed.item, prev: facing.item } as const;
  return {
    state: { ...updatePlayer(state, playerId, () => ({ location })), rngState: facing.rng },
    events: [{ type: 'PlayerPlaced', playerId, tile: location.tile, prev: location.prev }],
  };
}

/**
 * A random item; a single item is taken without drawing from the RNG, as at forks. This is an
 * engine detail, not a rule: the engine's RNG is its own, and the choice is the same either way.
 */
function pickOne<T>(items: readonly T[], rng: RngState): { item: T; rng: RngState } {
  if (items.length === 1) {
    return { item: at(items, 0), rng };
  }
  const [pick, next] = nextInt(rng, items.length);
  return { item: at(items, pick), rng: next };
}

/** Where an on-board player stands; only placed players move or land, so offBoard is a bug. */
function boardLocation(player: PlayerState): { tile: TileIndex; prev: TileIndex } {
  if (player.location.kind !== 'onBoard') {
    throw new Error(`player ${player.id} is not on the board`);
  }
  return player.location;
}

function endGame(state: GameState, reason: GameEndReason, winners: PlayerId[]): Step {
  const worth = Object.fromEntries(state.players.map((p) => [p.id, netWorth(state, p.id)]));
  return {
    state: { ...state, turn: { ...state.turn, phase: { kind: 'gameOver', winners } } },
    events: [{ type: 'GameEnded', reason, winners, netWorth: worth }],
  };
}
