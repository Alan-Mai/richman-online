// State transitions of the rule engine. Pure and deterministic: randomness only comes from
// state.rngState (see CLAUDE.md and .claude/rules/shared-engine.md).
import { validateBoard, type Board, type BoardError } from './board';
import { validateRuleConfig, type RuleConfig, type RuleConfigError } from './config';
import type { GameEvent } from './events';
import type { PlayerId } from './ids';
import { createRng, isUint32 } from './rng';
import type { GameState, PlayerState } from './state';

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
