// State transitions of the rule engine. Pure and deterministic: randomness only comes from
// state.rngState (see CLAUDE.md and .claude/rules/shared-engine.md).
import type { Action, ActionType } from './actions';
import { isPlaceable, validateBoard, type Board, type BoardError } from './board';
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
  const players = setup.players.map(({ id, name }): PlayerState => ({
    id,
    name,
    cash: config.startingCash,
    deposit: config.startingDeposit,
    points: config.startingPoints,
    location: { kind: 'offBoard' },
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
  const started = startTurn(state, first.id, 1);
  return { ok: true, state: started.state, events: started.events };
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
  if (spendable(playerOf(state, playerId)) < phase.price) {
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
 * Where one step from `position` leads, having come from `prev` (docs/GAME_RULES.md §2): any link
 * that is not blocked and does not lead back to prev; a random one of them at a fork; back to prev
 * at a dead end. Only forks draw from the RNG.
 */
export function stepFrom(
  board: Board,
  position: TileIndex,
  prev: TileIndex,
  rng: RngState,
): { to: TileIndex; rng: RngState } {
  const candidates = at(board.tiles, position)
    .links.filter((link) => link.blocked !== true && link.to !== prev)
    .map((link) => link.to);
  if (candidates.length === 0) {
    return { to: prev, rng };
  }
  if (candidates.length === 1) {
    return { to: at(candidates, 0), rng };
  }
  const [pick, next] = nextInt(rng, candidates.length);
  return { to: at(candidates, pick), rng: next };
}

/**
 * Walks `steps` tiles. Every tile passed (not the landing tile) gets its pass trigger; when a
 * trigger does something, the PlayerMoved path is split there so the client can play the effect at
 * the right spot.
 */
function advance(state: GameState, playerId: PlayerId, steps: number): Step {
  let current = state;
  const events: GameEvent[] = [];
  let segment: TileIndex[] = [];
  let { tile, prev } = boardLocation(playerOf(state, playerId));
  for (let step = 1; step <= steps; step++) {
    const next = stepFrom(state.board, tile, prev, current.rngState);
    current = { ...current, rngState: next.rng };
    prev = tile;
    tile = next.to;
    segment.push(tile);
    if (step === steps) {
      break;
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
  return {
    state: updatePlayer(current, playerId, () => ({ location: { kind: 'onBoard', tile, prev } })),
    events,
  };
}

/**
 * Effect of walking over a tile without stopping. No tile has one yet; banks and road blocks
 * (Phase 5) will take the player and tile.
 */
function resolvePass(state: GameState): Step {
  return { state, events: [] };
}

/** Effect of stopping on the current player's tile. */
function resolveLanding(state: GameState): Step {
  const { config } = state;
  const player = playerOf(state, state.turn.current);
  const index = boardLocation(player).tile;
  const tile = at(state.board.tiles, index);
  if (tile.kind !== 'property') {
    return endTurn(state);
  }

  const { owner, level } = at(state.tiles, index);
  const funds = spendable(player);
  if (owner === null) {
    if (funds >= tile.price) {
      return awaitDecision(state, { kind: 'awaitBuyDecision', tile: index, price: tile.price });
    }
  } else if (owner === player.id) {
    const cost = upgradeCost(tile.price, config);
    if (level < config.maxLevel && funds >= cost) {
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
  return startTurn(state, at(players, nextSeat).id, round);
}

/** Hands the turn to playerId, placing them on the board first if this is their first turn. */
function startTurn(state: GameState, playerId: PlayerId, round: number): Step {
  const started: Step = {
    state: { ...state, turn: { current: playerId, round, phase: { kind: 'awaitRoll' } } },
    events: [{ type: 'TurnStarted', playerId, round }],
  };
  return chain(started, (s) => placeIfOffBoard(s, playerId));
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
