// State transitions of the rule engine. Pure and deterministic: randomness only comes from
// state.rngState (see CLAUDE.md and .claude/rules/shared-engine.md).
import type { Action, ActionType } from './actions';
import { prevOf, validateBoard, type Board, type BoardError } from './board';
import { validateRuleConfig, type RuleConfig, type RuleConfigError } from './config';
import type { RuleError } from './errors';
import type { GameEvent } from './events';
import type { PlayerId, TileIndex } from './ids';
import { createRng, isUint32, nextInt, type RngState } from './rng';
import { pay, rentFor, spend, spendable, totalAssets, upgradeCost } from './money';
import type { GameState, Phase, PhaseKind, PlayerState } from './state';
import { at, chain, findPlayer, playerOf, updatePlayer, updateTile, type Step } from './update';

type BuyDecision = Extract<Phase, { kind: 'awaitBuyDecision' }>;
type UpgradeDecision = Extract<Phase, { kind: 'awaitUpgradeDecision' }>;

export interface PlayerSetup {
  id: PlayerId;
  name: string;
}

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
  | { reason: 'invalidSeed' };

export type CreateGameResult =
  { ok: true; state: GameState; events: GameEvent[] } | { ok: false; errors: CreateGameError[] };

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
  players.forEach(({ id }, seat) => {
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

/** Validates the setup and deals the opening state; seat 0 moves first. */
export function createGame(setup: GameSetup): CreateGameResult {
  const errors = validateSetup(setup);
  const first = setup.players[0];
  if (errors.length > 0 || first === undefined) {
    return { ok: false, errors };
  }

  const { config, board } = setup;
  const players = setup.players.map(({ id, name }): PlayerState => ({
    id,
    name,
    cash: config.startingCash,
    deposit: config.startingDeposit,
    points: config.startingPoints,
    position: board.start,
    direction: 'forward',
    diceCount: config.defaultDiceCount,
    bankrupt: false,
  }));
  const state: GameState = {
    config,
    board,
    players,
    tiles: board.tiles.map(() => ({ owner: null, level: 0 })),
    turn: { current: first.id, round: 1, phase: { kind: 'awaitRoll' } },
    rngState: createRng(setup.seed),
  };
  return { ok: true, state, events: [{ type: 'TurnStarted', playerId: first.id, round: 1 }] };
}

export type Result =
  { ok: true; state: GameState; events: GameEvent[] } | { ok: false; error: RuleError };

const ACTION_TYPES: ReadonlySet<string> = new Set<ActionType>([
  'rollDice',
  'buyProperty',
  'upgradeProperty',
  'decline',
]);

/** Actions arrive from the network; rebuild a clean Action or reject the shape. */
function parseAction(raw: unknown): Action | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return null;
  }
  const { type, playerId } = raw as Record<string, unknown>;
  if (typeof type !== 'string' || !ACTION_TYPES.has(type) || typeof playerId !== 'string') {
    return null;
  }
  return { type: type as ActionType, playerId };
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
  if (action.playerId !== state.turn.current) {
    return reject({ code: 'notYourTurn' });
  }

  switch (action.type) {
    case 'rollDice':
      return phase.kind === 'awaitRoll' ? accept(rollDice(state)) : wrongPhase(phase.kind);
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
  }
}

/** Server-only: the actions playerId may send now. Empty unless it is their turn. */
export function legalActions(state: GameState, playerId: PlayerId): Action[] {
  if (playerId !== state.turn.current) {
    return [];
  }
  switch (state.turn.phase.kind) {
    case 'awaitRoll':
      return [{ type: 'rollDice', playerId }];
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
    case 'gameOver':
      return [];
  }
}

function buyProperty(state: GameState, phase: BuyDecision): Result {
  const playerId = state.turn.current;
  if (spendable(playerOf(state, playerId), state.config) < phase.price) {
    return reject({ code: 'insufficientFunds' });
  }
  const paid = spend(state, playerId, phase.price);
  const bought: Step = {
    state: updateTile(paid.state, phase.tile, { owner: playerId, level: 0 }),
    events: [
      ...paid.events,
      { type: 'PropertyBought', playerId, tile: phase.tile, price: phase.price },
    ],
  };
  return accept(chain(bought, endTurn));
}

function upgradeProperty(state: GameState, phase: UpgradeDecision): Result {
  const playerId = state.turn.current;
  if (spendable(playerOf(state, playerId), state.config) < phase.cost) {
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

  const moved = advance({ ...state, rngState: rng }, player.id, total);
  const landed = resolveLanding(moved.state);
  return {
    state: landed.state,
    events: [
      { type: 'DiceRolled', playerId: player.id, dice, total },
      ...moved.events,
      ...landed.events,
    ],
  };
}

/**
 * Walks `steps` tiles in the player's direction. Every tile passed (not the landing tile) gets its
 * pass trigger; when a trigger does something, the PlayerMoved path is split there so the client
 * can play the effect at the right spot.
 */
function advance(state: GameState, playerId: PlayerId, steps: number): Step {
  const { board } = state;
  const player = playerOf(state, playerId);
  const prev = player.direction === 'backward' ? prevOf(board) : null;
  const stepFrom = (tile: TileIndex): TileIndex =>
    at(prev === null ? at(board.tiles, tile).next : at(prev, tile), 0);

  let current = state;
  const events: GameEvent[] = [];
  let segment: TileIndex[] = [];
  let position = player.position;
  for (let step = 1; step <= steps; step++) {
    position = stepFrom(position);
    segment.push(position);
    if (step === steps) {
      break;
    }
    const passed = resolvePass(current, playerId, position);
    if (passed.events.length > 0) {
      events.push({ type: 'PlayerMoved', playerId, path: segment }, ...passed.events);
      segment = [];
      current = passed.state;
    }
  }
  if (segment.length > 0) {
    events.push({ type: 'PlayerMoved', playerId, path: segment });
  }
  return { state: updatePlayer(current, playerId, () => ({ position })), events };
}

/** Effect of walking over a tile without stopping. Phase 2: only the optional start bonus. */
function resolvePass(state: GameState, playerId: PlayerId, tile: TileIndex): Step {
  const amount = state.config.passStartBonus;
  if (tile !== state.board.start || amount === 0) {
    return { state, events: [] };
  }
  return {
    state: updatePlayer(state, playerId, (p) => ({ cash: p.cash + amount })),
    events: [{ type: 'PassBonusReceived', playerId, tile, amount }],
  };
}

/** Effect of stopping on the current player's tile. */
function resolveLanding(state: GameState): Step {
  const { config } = state;
  const player = playerOf(state, state.turn.current);
  const index = player.position;
  const tile = at(state.board.tiles, index);
  if (tile.kind !== 'property') {
    return endTurn(state);
  }

  const { owner, level } = at(state.tiles, index);
  const funds = spendable(player, config);
  if (owner === null) {
    if (funds >= tile.price) {
      return awaitDecision(state, { kind: 'awaitBuyDecision', tile: index, price: tile.price });
    }
  } else if (owner === player.id) {
    const cost = upgradeCost(tile.price, config);
    if (config.upgradeOnOwnTile && level < config.maxLevel && funds >= cost) {
      return awaitDecision(state, { kind: 'awaitUpgradeDecision', tile: index, cost });
    }
  } else {
    const amount = rentFor(tile, level, config);
    const paid = pay(state, player.id, { kind: 'rent', tile: index, creditor: owner, amount });
    const events: GameEvent[] = paid.bankrupt
      ? paid.events
      : [...paid.events, { type: 'RentPaid', from: player.id, to: owner, tile: index, amount }];
    return chain({ state: paid.state, events }, endTurn);
  }
  return endTurn(state);
}

function awaitDecision(state: GameState, phase: Phase): Step {
  return { state: { ...state, turn: { ...state.turn, phase } }, events: [] };
}

/**
 * Ends the current turn (docs/GAME_RULES.md §1): with at most one player left the game is over;
 * otherwise the next player who is not bankrupt moves. Wrapping past the last seat closes the round,
 * which ends a richestAtRoundLimit game at maxRounds or starts the next round.
 */
function endTurn(state: GameState): Step {
  const { players, config } = state;
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
  if (
    wrapped &&
    config.winCondition === 'richestAtRoundLimit' &&
    state.turn.round === config.maxRounds
  ) {
    const assets = standing.map((p) => totalAssets(state, p.id));
    const best = Math.max(...assets);
    return endGame(
      state,
      'roundLimit',
      standing.filter((_, i) => assets[i] === best).map((p) => p.id),
    );
  }

  const round = wrapped ? state.turn.round + 1 : state.turn.round;
  const next = at(players, nextSeat).id;
  return {
    state: { ...state, turn: { current: next, round, phase: { kind: 'awaitRoll' } } },
    events: [{ type: 'TurnStarted', playerId: next, round }],
  };
}

function endGame(
  state: GameState,
  reason: 'lastStanding' | 'roundLimit',
  winners: PlayerId[],
): Step {
  const assets = Object.fromEntries(state.players.map((p) => [p.id, totalAssets(state, p.id)]));
  return {
    state: { ...state, turn: { ...state.turn, phase: { kind: 'gameOver', winners } } },
    events: [{ type: 'GameEnded', reason, winners, totalAssets: assets }],
  };
}
