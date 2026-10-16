import { describe, expect, it } from 'vitest';
import type { Action } from './actions';
import type { Board, TileDef, TileLink } from './board';
import { DEFAULT_RULE_CONFIG } from './config';
import { applyAction, createGame, legalActions } from './engine';
import type { GameEvent } from './events';
import type { TileIndex } from './ids';
import { TEST_LOOP_BOARD } from './maps/test-loop';
import type { GameState, PlayerLocation } from './state';
import {
  applyOk,
  concrete,
  getPlayer,
  loopBoard,
  newTestGame,
  patchPlayer,
  placePlayer,
  scriptedRng,
} from './testing';

const roll = (playerId: string): Action => ({ type: 'rollDice', playerId });
const OFF_BOARD: PlayerLocation = { kind: 'offBoard' };

/** Tiles from a list of neighbour lists; every tile is blank. */
function boardOf(links: readonly (readonly (number | TileLink)[])[]): Board {
  const tiles = links.map((list, i): TileDef => ({
    kind: 'blank',
    name: `T${i}`,
    links: list.map((link) => (typeof link === 'number' ? { to: link } : link)),
    pos: { x: i, y: 0 },
  }));
  return { id: 'place', name: 'place', tiles };
}

const withTiles = (board: Board, patch: Record<number, Partial<TileDef>>): Board => ({
  ...board,
  tiles: board.tiles.map((tile, i) => ({ ...tile, ...patch[i] }) as TileDef),
});

/**
 * p1 stands on tile 0 and is about to roll; p2 is off the board, so p2's placement runs when p1's
 * turn ends. The RNG is scripted to `values` (p1's die is the first, 0-based).
 */
function beforeP2Placement(
  board: Board,
  values: number[],
  options: { playerCount?: number; maxPlayers?: number } = {},
): GameState {
  const state = newTestGame({
    board,
    playerCount: options.playerCount ?? 2,
    config: { maxPlayers: options.maxPlayers ?? DEFAULT_RULE_CONFIG.maxPlayers },
  });
  return { ...patchPlayer(state, 'p2', { location: OFF_BOARD }), rngState: scriptedRng(values) };
}

/** Every tile p2 can be placed on: tries each placement pick until the candidates run out. */
function placementTiles(state: (pick: number) => GameState): TileIndex[] {
  const tiles: TileIndex[] = [];
  for (let pick = 0; pick <= 64; pick++) {
    let after: GameState;
    try {
      after = applyOk(state(pick), roll('p1')).state;
    } catch (error) {
      if (error instanceof RangeError) break;
      throw error;
    }
    const { location } = getPlayer(after, 'p2');
    if (location.kind === 'onBoard') tiles.push(location.tile);
  }
  return tiles;
}

describe('first-turn placement', () => {
  it('places seat 0 in createGame and the others when their first turn starts', () => {
    const start = newTestGame({ playerCount: 3, placement: 'engine' });
    expect(getPlayer(start, 'p1').location.kind).toBe('onBoard');
    expect(getPlayer(start, 'p2').location).toEqual(OFF_BOARD);
    expect(getPlayer(start, 'p3').location).toEqual(OFF_BOARD);

    // p1 (moved to tile 0) rolls 1 onto property 1 and declines. Free tiles are 0, 2, 3, 4, ...;
    // pick 3 is tile 4, and neighbour 1 of tile 4 is tile 3.
    const rolled = applyOk(
      { ...placePlayer(start, 'p1', 0), rngState: scriptedRng([0]) },
      roll('p1'),
    );
    expect(rolled.state.turn.phase.kind).toBe('awaitBuyDecision');
    expect(getPlayer(rolled.state, 'p2').location).toEqual(OFF_BOARD);
    const { state: after, events } = applyOk(
      { ...rolled.state, rngState: scriptedRng([3, 1]) },
      { type: 'decline', playerId: 'p1' },
    );
    expect(events).toEqual([
      { type: 'TurnStarted', playerId: 'p2', round: 1 },
      { type: 'PlayerPlaced', playerId: 'p2', tile: 4, prev: 3 },
    ]);
    expect(getPlayer(after, 'p2').location).toEqual({ kind: 'onBoard', tile: 4, prev: 3 });
    expect(getPlayer(after, 'p3').location).toEqual(OFF_BOARD);
    expect(after.rngState).toEqual(scriptedRng([]));
  });

  it('lets the placed player roll in the same turn, from the start tile', () => {
    const board = loopBoard(Array.from({ length: 10 }, () => null));
    // p1 rolls 1 (to tile 1); p2 goes to free tile #4 = tile 5, facing away from tile 4.
    const placed = applyOk(beforeP2Placement(board, [0, 4, 1]), roll('p1')).state;
    expect(placed.turn).toEqual({ current: 'p2', round: 1, phase: { kind: 'awaitRoll' } });
    expect(legalActions(placed, 'p2')).toEqual([roll('p2')]);
    expect(getPlayer(placed, 'p2').location).toEqual({ kind: 'onBoard', tile: 5, prev: 4 });

    const { events } = applyOk({ ...placed, rngState: scriptedRng([1]) }, roll('p2'));
    expect(events.find((e) => e.type === 'PlayerMoved')).toEqual({
      type: 'PlayerMoved',
      playerId: 'p2',
      path: [6, 7],
    });
  });

  it('skips noRandomPlacement, unsupported, linkless and occupied tiles', () => {
    // Ten blank tiles in a loop plus tile 10 without links (the state bypasses validateBoard).
    const board = withTiles(loopBoard(Array.from({ length: 10 }, () => null)), {
      3: { noRandomPlacement: true },
      5: { kind: 'unsupported', feature: 'largeBuilding' },
    });
    const isolated: TileDef = { kind: 'blank', name: 'X', links: [], pos: { x: 0, y: 1 } };
    // p1 leaves tile 0 for tile 1; p3 stands on tile 7.
    const state = (pick: number): GameState => {
      const base = placePlayer(beforeP2Placement(board, [0, pick, 0], { playerCount: 3 }), 'p3', 7);
      return {
        ...base,
        board: { ...board, tiles: [...board.tiles, isolated] },
        tiles: [...base.tiles, { owner: null, level: 0 }],
      };
    };
    // Tile 0, where p1 started, is free again.
    expect(placementTiles(state)).toEqual([0, 2, 4, 6, 8, 9]);
  });

  it('counts bankrupt players as still occupying the tile they went bankrupt on', () => {
    const board = loopBoard(Array.from({ length: 6 }, () => null));
    const state = (pick: number) => {
      const base = placePlayer(beforeP2Placement(board, [0, pick, 0], { playerCount: 3 }), 'p3', 4);
      return patchPlayer(base, 'p3', { bankrupt: true, cash: 0, deposit: 0 });
    };
    expect(placementTiles(state)).toEqual([0, 2, 3, 5]);
  });

  it('faces away from a random neighbour, blocked or not', () => {
    // Loop 0-1-2-3; tile 2 may not be left towards 1. Only tiles 2 and 3 are placeable.
    const board = withTiles(
      boardOf([
        [1, 3],
        [0, 2],
        [3, { to: 1, blocked: true }],
        [2, 0],
      ]),
      {
        0: { noRandomPlacement: true },
        1: { noRandomPlacement: true },
      },
    );
    const placedOn = (prevPick: number) => {
      const start = beforeP2Placement(board, [0, 0, prevPick], { maxPlayers: 2 });
      return getPlayer(applyOk(start, roll('p1')).state, 'p2').location;
    };
    expect(placedOn(0)).toEqual({ kind: 'onBoard', tile: 2, prev: 3 });
    expect(placedOn(1)).toEqual({ kind: 'onBoard', tile: 2, prev: 1 });
  });

  it('walks back from a dead-end start', () => {
    // Loop 0-1-2-3 with a spur 2-4; only tiles 3 and 4 are placeable.
    const board = withTiles(boardOf([[1, 3], [0, 2], [1, 3, 4], [2, 0], [2]]), {
      0: { noRandomPlacement: true },
      1: { noRandomPlacement: true },
      2: { noRandomPlacement: true },
    });
    // p1 rolls 1; p2 goes to tile 4 (one neighbour, so no draw for prev), then rolls 1.
    const placed = applyOk(beforeP2Placement(board, [0, 1], { maxPlayers: 2 }), roll('p1'));
    expect(placed.events.at(-1)).toEqual({
      type: 'PlayerPlaced',
      playerId: 'p2',
      tile: 4,
      prev: 2,
    });
    expect(placed.state.rngState).toEqual(scriptedRng([]));

    const moved = applyOk({ ...placed.state, rngState: scriptedRng([0]) }, roll('p2'));
    expect(moved.events.find((e) => e.type === 'PlayerMoved')).toMatchObject({ path: [2] });
  });

  it('places each player exactly once', () => {
    let state = newTestGame({ playerCount: 4, placement: 'engine' });
    const events: GameEvent[] = [];
    while (state.turn.round <= 3) {
      expect(getPlayer(state, state.turn.current).location.kind).toBe('onBoard');
      const actions = legalActions(state, state.turn.current);
      const last = actions.at(-1);
      const step = applyOk(state, last === undefined ? roll(state.turn.current) : concrete(last));
      events.push(...step.events);
      state = step.state;
    }
    const placed = events.flatMap((e) => (e.type === 'PlayerPlaced' ? [e.playerId] : []));
    expect(placed).toEqual(['p2', 'p3', 'p4']);
    for (const player of state.players) expect(player.location.kind).toBe('onBoard');
  });

  it('starts players on random tiles and directions, the same for the same seed', () => {
    const tiles = new Set<TileIndex>();
    const directions = new Set<'clockwise' | 'counterclockwise'>();
    const n = TEST_LOOP_BOARD.tiles.length;
    for (let seed = 1; seed <= 40; seed++) {
      const setup = {
        config: DEFAULT_RULE_CONFIG,
        board: TEST_LOOP_BOARD,
        players: [
          { id: 'a', name: 'A', controller: 'human' as const },
          { id: 'b', name: 'B', controller: 'human' as const },
        ],
        seed,
      };
      const result = createGame(setup);
      if (!result.ok) throw new Error('expected ok');
      expect(createGame(setup)).toEqual(result);
      const { location } = getPlayer(result.state, 'a');
      expect(location.kind).toBe('onBoard');
      if (location.kind !== 'onBoard') return;
      tiles.add(location.tile);
      directions.add(
        location.prev === (location.tile + n - 1) % n ? 'clockwise' : 'counterclockwise',
      );
    }
    // 40 seeds over 20 tiles: clearly not a fixed start, and both directions occur.
    expect(tiles.size).toBeGreaterThan(10);
    expect(directions.size).toBe(2);
  });

  it('treats a board without a free placeable tile as an engine bug', () => {
    // validateBoard rules this out; the state bypasses it.
    const loop = loopBoard(Array.from({ length: 4 }, () => null));
    const blocked = withTiles(loop, {
      0: { noRandomPlacement: true },
      2: { noRandomPlacement: true },
    });
    // Tile 1 is where p1 lands and tile 3 is taken by p3, so nothing is left for p2.
    const state = placePlayer(beforeP2Placement(loop, [0], { playerCount: 3 }), 'p3', 3);
    expect(() => applyAction({ ...state, board: blocked }, roll('p1'))).toThrow(
      /no tile to place p2/,
    );
  });
});
