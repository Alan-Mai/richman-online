import { describe, expect, it } from 'vitest';
import type { Board } from './board';
import { DEFAULT_RULE_CONFIG, type RuleConfig } from './config';
import { createGame, type GameSetup } from './engine';
import { TEST_LOOP_BOARD } from './maps/test-loop';
import { createRng, nextInt, type RngState } from './rng';

const PLAYERS = [
  { id: 'p1', name: '甲' },
  { id: 'p2', name: '乙' },
  { id: 'p3', name: '丙' },
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

function withConfig(patch: Partial<RuleConfig>): RuleConfig {
  return { ...DEFAULT_RULE_CONFIG, ...patch };
}

/** Where each of `count` players faces from on TEST_LOOP_BOARD: links of start are [1, 19]. */
function startPrevs(seed: number, count: number): number[] {
  let rng = createRng(seed);
  return Array.from({ length: count }, () => {
    const [pick, next] = nextInt(rng, 2);
    rng = next;
    return pick === 0 ? 1 : 19;
  });
}

/** The RNG state after `count` draws of nextInt(range) from `seed`. */
function afterDraws(seed: number, count: number, range: number): RngState {
  let rng = createRng(seed);
  for (let i = 0; i < count; i++) [, rng] = nextInt(rng, range);
  return rng;
}

function players(count: number) {
  return Array.from({ length: count }, (_, i) => ({ id: `p${i}`, name: `玩家${i}` }));
}

describe('createGame', () => {
  it('builds the initial state', () => {
    const result = createGame(setup());
    if (!result.ok) throw new Error('expected ok');
    const { state } = result;

    expect(state.config).toBe(DEFAULT_RULE_CONFIG);
    expect(state.board).toBe(TEST_LOOP_BOARD);
    expect(state.players).toEqual(
      PLAYERS.map(({ id, name }, seat) => ({
        id,
        name,
        cash: DEFAULT_RULE_CONFIG.startingCash,
        deposit: DEFAULT_RULE_CONFIG.startingDeposit,
        points: DEFAULT_RULE_CONFIG.startingPoints,
        position: TEST_LOOP_BOARD.start,
        prev: startPrevs(42, PLAYERS.length)[seat],
        diceCount: DEFAULT_RULE_CONFIG.defaultDiceCount,
        bankrupt: false,
      })),
    );
    expect(state.tiles).toHaveLength(TEST_LOOP_BOARD.tiles.length);
    for (const tile of state.tiles) expect(tile).toEqual({ owner: null, level: 0 });
    expect(state.turn).toEqual({ current: 'p1', round: 1, phase: { kind: 'awaitRoll' } });
    // One draw per player for the starting direction (start has two neighbours).
    expect(state.rngState).toEqual(afterDraws(42, PLAYERS.length, 2));
  });

  it('uses the configured starting values', () => {
    const config = withConfig({
      startingCash: 7,
      startingDeposit: 8,
      startingPoints: 9,
      defaultDiceCount: 2,
    });
    const result = createGame(setup({ config }));
    if (!result.ok) throw new Error('expected ok');
    expect(result.state.players[0]).toMatchObject({ cash: 7, deposit: 8, points: 9, diceCount: 2 });
  });

  it('places everyone on board.start', () => {
    const board: Board = { ...TEST_LOOP_BOARD, start: 5 };
    const result = createGame(setup({ board }));
    if (!result.ok) throw new Error('expected ok');
    for (const player of result.state.players) expect(player.position).toBe(5);
  });

  it('faces each player from a random neighbour of start', () => {
    const prevs = new Set<number>();
    for (let seed = 1; seed <= 20; seed++) {
      const result = createGame(setup({ seed }));
      if (!result.ok) throw new Error('expected ok');
      for (const player of result.state.players) {
        expect([1, 19]).toContain(player.prev);
        prevs.add(player.prev);
      }
    }
    expect([...prevs].sort((a, b) => a - b)).toEqual([1, 19]);
  });

  it('starts the first turn with a TurnStarted event', () => {
    const result = createGame(setup());
    if (!result.ok) throw new Error('expected ok');
    expect(result.events).toEqual([{ type: 'TurnStarted', playerId: 'p1', round: 1 }]);
  });

  it('is deterministic for the same seed', () => {
    expect(createGame(setup())).toEqual(createGame(setup()));
  });

  it('reports config errors', () => {
    const config = withConfig({ maxLevel: 4 });
    const result = createGame(setup({ config }));
    expect(result).toEqual({
      ok: false,
      errors: [
        { reason: 'config', error: { field: 'rentPercentByLevel', reason: 'lengthMismatch' } },
      ],
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
          { id: 'p1', name: 'a' },
          { id: 'p1', name: 'b' },
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
          { id: '', name: 'a' },
          { id: 'p2', name: 'b' },
        ],
      }),
    );
    expect(empty).toEqual({ ok: false, errors: [{ reason: 'emptyPlayerId', seat: 0 }] });
  });

  it('accepts the uint32 seed bounds', () => {
    expect(createGame(setup({ seed: 0 })).ok).toBe(true);
    const max = createGame(setup({ seed: 2 ** 32 - 1 }));
    if (!max.ok) throw new Error('expected ok');
    expect(max.state.rngState).toEqual(afterDraws(2 ** 32 - 1, PLAYERS.length, 2));
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
        config: withConfig({ startingCash: -1 }),
        board: { ...TEST_LOOP_BOARD, start: 99 },
        players: players(1),
        seed: -1,
      }),
    );
    expect(result).toEqual({
      ok: false,
      errors: [
        { reason: 'config', error: { field: 'startingCash', reason: 'notNonNegativeInteger' } },
        { reason: 'board', error: { reason: 'startOutOfRange' } },
        { reason: 'playerCount', count: 1 },
        { reason: 'invalidSeed' },
      ],
    });
  });
});
