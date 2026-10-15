import { describe, expect, it } from 'vitest';
import type { TileDef } from './board';
import { DEFAULT_RULE_CONFIG, type RuleConfig } from './config';
import { createGame, type GameSetup, type PlayerSetup } from './engine';
import { TEST_LOOP_BOARD } from './maps/test-loop';
import { createRng, nextInt, type RngState } from './rng';

const PLAYERS = [
  { id: 'p1', name: '甲', controller: 'human' as const },
  { id: 'p2', name: '乙', controller: 'computer' as const },
  { id: 'p3', name: '丙', controller: 'human' as const },
];

function setup(patch: Partial<GameSetup> = {}): GameSetup {
  return {
    config: DEFAULT_RULE_CONFIG,
    board: TEST_LOOP_BOARD,
    players: PLAYERS,
    seed: 42,
    ...patch,
  };
}

const unplaceable = (tile: TileDef): TileDef => ({ ...tile, noRandomPlacement: true });

function withConfig(patch: Partial<RuleConfig>): RuleConfig {
  return { ...DEFAULT_RULE_CONFIG, ...patch };
}

/** The RNG state after one nextInt draw per entry of `ranges`, from `seed`. */
function afterDraws(seed: number, ranges: readonly number[]): RngState {
  let rng = createRng(seed);
  for (const range of ranges) [, rng] = nextInt(rng, range);
  return rng;
}

/** Seat 0's placement on TEST_LOOP_BOARD: one of 20 tiles, then one of its 2 neighbours. */
const PLACEMENT_DRAWS = [20, 2];

function players(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `p${i}`,
    name: `玩家${i}`,
    controller: 'human' as const,
  }));
}

describe('createGame', () => {
  it('builds the initial state', () => {
    const result = createGame(setup());
    if (!result.ok) throw new Error('expected ok');
    const { state } = result;

    expect(state.config).toBe(DEFAULT_RULE_CONFIG);
    expect(state.board).toBe(TEST_LOOP_BOARD);
    // Only seat 0 is placed; the rest wait for their first turn (engine.place.test.ts).
    expect(state.players).toEqual(
      PLAYERS.map(({ id, name, controller }, seat) => ({
        id,
        name,
        controller,
        cash: DEFAULT_RULE_CONFIG.startingFunds / 2,
        deposit: DEFAULT_RULE_CONFIG.startingFunds / 2,
        points: DEFAULT_RULE_CONFIG.startingPoints,
        location: expect.objectContaining({ kind: seat === 0 ? 'onBoard' : 'offBoard' }) as unknown,
        vehicle: 'walk',
        diceCount: 1,
        bankrupt: false,
      })),
    );
    expect(state.tiles).toHaveLength(TEST_LOOP_BOARD.tiles.length);
    for (const tile of state.tiles) expect(tile).toEqual({ owner: null, level: 0 });
    expect(state.turn).toEqual({ current: 'p1', round: 1, phase: { kind: 'awaitRoll' } });
    expect(state).toMatchObject({ day: 0, priceIndex: 1, lotteryPool: 0 });
    expect(state.rngState).toEqual(afterDraws(42, PLACEMENT_DRAWS));
  });

  it('uses the configured starting values', () => {
    const config = withConfig({ startingFunds: 16, startingPoints: 9 });
    const result = createGame(setup({ config }));
    if (!result.ok) throw new Error('expected ok');
    expect(result.state.players[0]).toMatchObject({ cash: 8, deposit: 8, points: 9 });
  });

  it('puts everyone on the starting vehicle with as many dice as it allows', () => {
    const expected = [
      ['walk', 1],
      ['motorbike', 2],
      ['car', 3],
    ] as const;
    for (const [startingVehicle, diceCount] of expected) {
      const result = createGame(setup({ config: withConfig({ startingVehicle }) }));
      if (!result.ok) throw new Error('expected ok');
      for (const player of result.state.players) {
        expect(player).toMatchObject({ vehicle: startingVehicle, diceCount });
      }
    }
    const limits = { walk: 2, motorbike: 4, car: 5 };
    const config = withConfig({ startingVehicle: 'motorbike', vehicleMaxDice: limits });
    const result = createGame(setup({ config }));
    if (!result.ok) throw new Error('expected ok');
    expect(result.state.players.map((p) => p.diceCount)).toEqual([4, 4, 4]);
  });

  it('splits starting funds the same way for computer players (provisional, non-original)', () => {
    // The original splits by a character ratio from an executable table not exported yet.
    const result = createGame(setup({ config: withConfig({ startingFunds: 15 }) }));
    if (!result.ok) throw new Error('expected ok');
    const [human, computer] = result.state.players;
    expect(computer?.controller).toBe('computer');
    expect(computer).toMatchObject({ cash: 7, deposit: 7 });
    expect(human).toMatchObject({ cash: 7, deposit: 7 });
  });

  it('rejects an unknown controller', () => {
    const robot = { id: 'p2', name: 'b', controller: 'robot' } as unknown as PlayerSetup;
    const result = createGame(setup({ players: [PLAYERS[0] as PlayerSetup, robot] }));
    expect(result).toEqual({ ok: false, errors: [{ reason: 'invalidController', seat: 1 }] });
  });

  it('starts the first turn with TurnStarted, then places seat 0', () => {
    const result = createGame(setup());
    if (!result.ok) throw new Error('expected ok');
    expect(result.events.map((e) => e.type)).toEqual(['TurnStarted', 'PlayerPlaced']);
    expect(result.events[0]).toEqual({ type: 'TurnStarted', playerId: 'p1', round: 1 });
    expect(result.events[1]).toMatchObject({ type: 'PlayerPlaced', playerId: 'p1' });
  });

  it('is deterministic for the same seed', () => {
    expect(createGame(setup())).toEqual(createGame(setup()));
  });

  it('reports config errors', () => {
    const config = withConfig({ diceFaces: 0 });
    const result = createGame(setup({ config }));
    expect(result).toEqual({
      ok: false,
      errors: [{ reason: 'config', error: { field: 'diceFaces', reason: 'notPositiveInteger' } }],
    });
  });

  it('reports board errors', () => {
    const tiles = TEST_LOOP_BOARD.tiles.map((tile, i) =>
      i === 3 ? { ...tile, links: [...tile.links, { to: 5 }] } : tile,
    );
    const oneSided = createGame(setup({ board: { ...TEST_LOOP_BOARD, tiles } }));
    expect(oneSided.ok).toBe(false);
    if (oneSided.ok) return;
    expect(oneSided.errors).toContainEqual({
      reason: 'board',
      error: { reason: 'asymmetricLink', tile: 3 },
    });

    const empty = createGame(setup({ board: { ...TEST_LOOP_BOARD, tiles: [] } }));
    expect(empty).toEqual({ ok: false, errors: [{ reason: 'board', error: { reason: 'empty' } }] });
  });

  it('accepts exactly minPlayers and maxPlayers', () => {
    const { minPlayers, maxPlayers } = DEFAULT_RULE_CONFIG;
    expect(createGame(setup({ players: players(minPlayers) })).ok).toBe(true);
    expect(createGame(setup({ players: players(maxPlayers) })).ok).toBe(true);
  });

  it('rejects too few or too many players', () => {
    const { minPlayers, maxPlayers } = DEFAULT_RULE_CONFIG;
    for (const count of [minPlayers - 1, maxPlayers + 1]) {
      expect(createGame(setup({ players: players(count) }))).toEqual({
        ok: false,
        errors: [{ reason: 'playerCount', count }],
      });
    }
  });

  it('rejects duplicate and empty player ids', () => {
    const duplicate = createGame(
      setup({
        players: [
          { id: 'p1', name: 'a', controller: 'human' },
          { id: 'p1', name: 'b', controller: 'human' },
        ],
      }),
    );
    expect(duplicate).toEqual({
      ok: false,
      errors: [{ reason: 'duplicatePlayerId', playerId: 'p1' }],
    });

    const empty = createGame(
      setup({
        players: [
          { id: '', name: 'a', controller: 'human' },
          { id: 'p2', name: 'b', controller: 'human' },
        ],
      }),
    );
    expect(empty).toEqual({ ok: false, errors: [{ reason: 'emptyPlayerId', seat: 0 }] });
  });

  it('accepts the uint32 seed bounds', () => {
    expect(createGame(setup({ seed: 0 })).ok).toBe(true);
    const max = createGame(setup({ seed: 2 ** 32 - 1 }));
    if (!max.ok) throw new Error('expected ok');
    expect(max.state.rngState).toEqual(afterDraws(2 ** 32 - 1, PLACEMENT_DRAWS));
  });

  it('rejects seeds that are not uint32 without throwing', () => {
    for (const seed of [-1, 2 ** 32, 1.5, NaN]) {
      expect(createGame(setup({ seed }))).toEqual({
        ok: false,
        errors: [{ reason: 'invalidSeed' }],
      });
    }
  });

  it('rejects a scripted RNG object passed as the seed', () => {
    const seed = { kind: 'scripted', values: [5, 5, 5] } as unknown as number;
    expect(createGame(setup({ seed }))).toEqual({ ok: false, errors: [{ reason: 'invalidSeed' }] });
  });

  it('reports every problem at once', () => {
    const result = createGame(
      setup({
        config: withConfig({ startingFunds: -1 }),
        board: { ...TEST_LOOP_BOARD, tiles: TEST_LOOP_BOARD.tiles.map(unplaceable) },
        players: players(1),
        seed: -1,
      }),
    );
    expect(result).toEqual({
      ok: false,
      errors: [
        { reason: 'config', error: { field: 'startingFunds', reason: 'notPositiveInteger' } },
        { reason: 'board', error: { reason: 'tooFewPlacementTiles', count: 0, required: 4 } },
        { reason: 'playerCount', count: 1 },
        { reason: 'invalidSeed' },
      ],
    });
  });
});
