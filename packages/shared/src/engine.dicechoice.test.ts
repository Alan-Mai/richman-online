import { describe, expect, it } from 'vitest';
import type { Board, TileDef } from './board';
import { drawComputerDiceCount } from './computer';
import type { Vehicle } from './config';
import { computerAction, legalActions } from './engine';
import type { PlayerId } from './ids';
import { checkInvariants } from './invariants';
import { previewPath } from './movement';
import type { GameState } from './state';
import {
  applyOk,
  getPlayer,
  loopBoard,
  newTestGame,
  patchPlayer,
  patchTile,
  placePlayer,
  scriptedRng,
} from './testing';
import { viewFor } from './view';

/** 12 tiles: blank at 0 and 6, properties elsewhere. */
const BOARD = loopBoard([null, 1000, 1000, 1000, 1000, 1000, null, 1000, 1000, 1000, 1000, 1000]);

/** Only 3 properties among the five tiles after 0: 1, 2 and 3; 4 and 5 are blank. */
const SPARSE = loopBoard([null, 1000, 1000, 1000, null, null, 1000, 1000]);

type Owner = PlayerId | null;

/** p1 human, p2 computer on `vehicle`, standing on tile 0 and about to step onto 1, 2, 3, ... */
function game(vehicle: Vehicle, board: Board = BOARD): GameState {
  const state = newTestGame({
    board,
    controllers: ['human', 'computer'],
    config: { startingVehicle: vehicle },
  });
  return placePlayer(state, 'p2', 0);
}

/** Sets the owners of the given tiles. */
function owning(state: GameState, owners: Readonly<Record<number, Owner>>): GameState {
  return Object.entries(owners).reduce(
    (s, [i, owner]) => patchTile(s, Number(i), { owner }),
    state,
  );
}

/** Owners of tiles 1..5 in order. */
const ahead = (...owners: Owner[]) => Object.fromEntries(owners.map((o, i) => [i + 1, o]));

/** p2's dice count, drawing exactly `values` from the RNG (an unused value fails the test). */
function countFor(state: GameState, values: readonly number[] = []): number | undefined {
  const drawn = drawComputerDiceCount({ ...state, rngState: scriptedRng(values) }, 'p2');
  expect(drawn?.rng).toEqual({ kind: 'scripted', values: [] });
  return drawn?.count;
}

function blank(name: string, x: number, links: number[]): TileDef {
  return { kind: 'blank', name, pos: { x, y: 0 }, links: links.map((to) => ({ to })) };
}

describe('previewPath', () => {
  it('walks like a real move, drawing nothing off forks', () => {
    expect(previewPath(BOARD, 0, 11, 5, scriptedRng([]))).toEqual({
      path: [1, 2, 3, 4, 5],
      rng: { kind: 'scripted', values: [] },
    });
  });

  it('turns back at a dead end and picks at random at a fork', () => {
    // 0 - 1 - 2, a fork to 3 (dead end) and 4, which leads back to 0.
    const board: Board = {
      id: 'fork',
      name: 'fork',
      tiles: [
        blank('a', 0, [1, 4]),
        blank('b', 1, [0, 2]),
        blank('c', 2, [1, 3, 4]),
        blank('d', 3, [2]),
        blank('e', 4, [2, 0]),
      ],
    };
    // Fork at 2 coming from 1: candidates 3, 4; then from 3 back to 2; fork at 2 from 3: 1, 4.
    expect(previewPath(board, 0, 4, 5, scriptedRng([0, 1]))).toEqual({
      path: [1, 2, 3, 2, 4],
      rng: { kind: 'scripted', values: [] },
    });
  });
});

describe('computer dice count', () => {
  it('rolls 2 or 3 at random on a car, 2 on a motorbike, with no good tile and 3+ bad', () => {
    const car = owning(game('car'), ahead('p1', 'p1', 'p1', 'p1', 'p1'));
    expect(countFor(car, [0])).toBe(2);
    expect(countFor(car, [1])).toBe(3);
    const sparse = owning(game('car', SPARSE), ahead('p1', 'p1', 'p1'));
    expect(countFor(sparse, [1])).toBe(3);
    expect(countFor(owning(game('motorbike'), ahead('p1', 'p1', 'p1', 'p1', 'p1')))).toBe(2);
  });

  it('rolls 1 die with 2+ good tiles and at most 1 bad', () => {
    for (const vehicle of ['motorbike', 'car'] as const) {
      // Unowned tiles (also with buildings left by a bankruptcy) and own tiles are good.
      const four = patchTile(owning(game(vehicle), ahead(null, 'p2', 'p1', null, 'p2')), 1, {
        level: 3,
      });
      expect(countFor(four)).toBe(1);
      expect(countFor(owning(game(vehicle, SPARSE), ahead(null, 'p2', 'p1')))).toBe(1);
      expect(countFor(owning(game(vehicle, SPARSE), ahead('p2', 'p2')))).toBe(1);
    }
  });

  it('keeps the limit otherwise', () => {
    const cases: [Board, Record<number, Owner>][] = [
      [BOARD, ahead('p1', 'p1', 'p2', 'p1', 'p1')], // 1 good, 4 bad
      [BOARD, ahead('p1', 'p1', null, null, 'p1')], // 2 good, 3 bad
      [SPARSE, ahead('p1', 'p1', null)], // 1 good, 2 bad
      [SPARSE, ahead('p1', 'p1', 'p2')], // 1 good, 2 bad
    ];
    for (const [board, owners] of cases) {
      expect(countFor(owning(game('car', board), owners))).toBe(3);
      expect(countFor(owning(game('motorbike', board), owners))).toBe(2);
    }
    // No good and 2 bad: not enough bad ones.
    const two = loopBoard([null, 1000, 1000, null, null, null, 1000]);
    expect(countFor(owning(game('car', two), ahead('p1', 'p1')))).toBe(3);
  });

  it('counts only properties: blank tiles are neither good nor bad', () => {
    // Ahead of tile 2: 3, 4, 5, 6 (blank), 7.
    const from2 = placePlayer(game('car'), 'p2', 2, 1);
    // Were the blank good, there would be 1 good tile and no draw.
    expect(countFor(owning(from2, { 3: 'p1', 4: 'p1', 5: 'p1', 7: 'p1' }), [0])).toBe(2);
    // Were it bad, there would be 2 bad tiles and no single die.
    expect(countFor(owning(from2, { 3: 'p1', 4: null, 5: null, 7: null }))).toBe(1);
  });

  it('looks only at the five tiles ahead, not the one it stands on or the sixth', () => {
    // Standing on its own tile 1; ahead are 2..5 (bad) and 6 (blank); 7 (good) is the sixth.
    let state = placePlayer(game('car'), 'p2', 1, 0);
    state = owning(state, { 1: 'p2', 2: 'p1', 3: 'p1', 4: 'p1', 5: 'p1', 7: 'p2' });
    expect(countFor(state, [1])).toBe(3);
  });

  it('counts a tile once per visit when the preview turns back at a dead end', () => {
    // A spur 0 - 1 - 2 - 3 (dead end) off a loop 0 - 4 - 5 - 0; from 0 (coming from 4) the
    // preview steps on 1, 2, 3, 2, 1.
    const loop = loopBoard([null, 1000, 1000, 1000, null, null]).tiles;
    const linked = (i: number, links: number[]): TileDef => ({
      ...(loop[i] as TileDef),
      links: links.map((to) => ({ to })),
    });
    const spur: Board = {
      id: 'spur',
      name: 'spur',
      tiles: [
        linked(0, [1, 4, 5]),
        linked(1, [0, 2]),
        linked(2, [1, 3]),
        linked(3, [2]),
        linked(4, [0, 5]),
        linked(5, [4, 0]),
      ],
    };
    const start = placePlayer(game('car', spur), 'p2', 0, 4);
    // Fork at 0 coming from 4: candidates 1, 5; pick 0 goes up the spur.
    const at = (owners: Owner[], values: number[]) =>
      countFor(
        owning(start, { 1: owners[0] ?? null, 2: owners[1] ?? null, 3: owners[2] ?? null }),
        [0, ...values],
      );
    // Good 1 (tile 1 twice = 2), bad 3: limit. Once per tile would be good 1, bad 2: also limit.
    expect(at([null, 'p1', 'p1'], [])).toBe(3);
    // Tiles 1, 2 good and 3 bad: good 4, bad 1 → 1 die (once per tile also 1).
    expect(at([null, null, 'p1'], [])).toBe(1);
    // Tile 1 bad, 2 and 3 good: good 3, bad 2 → limit; once per tile would be good 2, bad 1 → 1.
    expect(at(['p1', null, null], [])).toBe(3);
    // Tile 3 good, 1 and 2 bad: good 1, bad 4 → limit.
    expect(at(['p1', 'p1', null], [])).toBe(3);
  });

  it('follows forks at random before drawing the car count', () => {
    // A shortcut from 2 to 5: out of 2 the preview goes on to 3 or cuts to 5.
    const loop = loopBoard([null, 1000, 1000, 1000, 1000, 1000, 1000, null]);
    const tiles = loop.tiles.map((t, i): TileDef => {
      if (i === 2) return { ...t, links: [...t.links, { to: 5 }] };
      if (i === 5) return { ...t, links: [...t.links, { to: 2 }] };
      return t;
    });
    const state = owning(game('car', { ...loop, tiles }), {
      1: 'p1',
      2: 'p1',
      3: null,
      4: null,
      5: 'p1',
      6: 'p1',
    });
    // Pick 0 at 2 (to 3): 1, 2, 3, 4, 5 → good 2, bad 3 → limit.
    expect(countFor(state, [0])).toBe(3);
    // Pick 1 at 2 (to 5), then pick 0 at 5 (to 6, not 4): 1, 2, 5, 6, 7 (blank) → good 0, bad 4
    // → draw 0 → 2.
    expect(countFor(state, [1, 0, 0])).toBe(2);
  });

  it('is not drawn on foot', () => {
    expect(drawComputerDiceCount(game('walk'), 'p2')).toBeNull();
  });
});

describe('computer dice count in play', () => {
  /**
   * p1 rolls one die, a 6, onto the blank tile 6, so p2's turn starts; then the RNG gives
   * `values`.
   */
  function p2Turn(vehicle: Vehicle, values: readonly number[]): GameState {
    const oneDie = patchPlayer(game(vehicle), 'p1', { diceCount: 1 });
    const state = owning(oneDie, ahead('p1', 'p1', 'p1', 'p1', 'p1'));
    const { state: after } = applyOk(
      { ...state, rngState: scriptedRng([5, ...values]) },
      { type: 'rollDice', playerId: 'p1' },
    );
    expect(after.turn.current).toBe('p2');
    return after;
  }

  it("is drawn as the computer's turn starts and set before it rolls", () => {
    let state = p2Turn('car', [0]);
    expect(state.turn.phase).toEqual({ kind: 'awaitRoll', computerDiceCount: 2 });
    expect(state.rngState).toEqual({ kind: 'scripted', values: [] });
    expect(checkInvariants(state)).toEqual([]);
    const set = computerAction(state, 'p2');
    expect(set).toEqual({ type: 'setDiceCount', playerId: 'p2', count: 2 });
    expect(legalActions(state, 'p2')).toContainEqual(set);
    state = applyOk(state, { type: 'setDiceCount', playerId: 'p2', count: 2 }).state;
    expect(getPlayer(state, 'p2').diceCount).toBe(2);
    expect(computerAction(state, 'p2')).toEqual({ type: 'rollDice', playerId: 'p2' });
  });

  it('rolls straight away when the chosen count is already set', () => {
    const state = p2Turn('car', [1]);
    expect(state.turn.phase).toEqual({ kind: 'awaitRoll', computerDiceCount: 3 });
    expect(computerAction(state, 'p2')).toEqual({ type: 'rollDice', playerId: 'p2' });
  });

  it('is not drawn on foot or for humans', () => {
    const walking = p2Turn('walk', []);
    expect(walking.turn.phase).toEqual({ kind: 'awaitRoll' });
    expect(walking.rngState).toEqual({ kind: 'scripted', values: [] });

    const humans = placePlayer(
      newTestGame({ board: BOARD, config: { startingVehicle: 'car' } }),
      'p2',
      0,
    );
    const owned = owning(
      patchPlayer(humans, 'p1', { diceCount: 1 }),
      ahead('p1', 'p1', 'p1', 'p1', 'p1'),
    );
    const { state } = applyOk(
      { ...owned, rngState: scriptedRng([5]) },
      { type: 'rollDice', playerId: 'p1' },
    );
    expect(state.turn.current).toBe('p2');
    expect(state.turn.phase).toEqual({ kind: 'awaitRoll' });
    expect(state.rngState).toEqual({ kind: 'scripted', values: [] });
  });

  it('is drawn after the first-turn placement, from the placed tile', () => {
    const state = newTestGame({
      board: BOARD,
      controllers: ['human', 'computer'],
      config: { startingVehicle: 'car' },
      placement: 'engine',
    });
    // p1 stands on 5 and rolls a 1 onto the blank 6; p2 is placed on 0 facing away from 11 (the
    // second of its links), looks at 1..5, all p1's, and draws 3.
    const p1 = patchPlayer(placePlayer(state, 'p1', 5, 4), 'p1', { diceCount: 1 });
    const ready = owning(p1, ahead('p1', 'p1', 'p1', 'p1', 'p1'));
    const placeable = [0, 1, 2, 3, 4, 5, 7, 8, 9, 10, 11];
    const { state: after, events } = applyOk(
      { ...ready, rngState: scriptedRng([0, placeable.indexOf(0), 1, 1]) },
      { type: 'rollDice', playerId: 'p1' },
    );
    expect(events).toContainEqual({ type: 'PlayerPlaced', playerId: 'p2', tile: 0, prev: 11 });
    expect(after.turn.phase).toEqual({ kind: 'awaitRoll', computerDiceCount: 3 });
  });

  it('is hidden from clients', () => {
    const state = p2Turn('car', [0]);
    for (const viewer of [
      { kind: 'player', id: 'p1' },
      { kind: 'player', id: 'p2' },
      { kind: 'spectator' },
    ] as const) {
      const view = viewFor(state, viewer);
      expect(view.turn.phase).toEqual({ kind: 'awaitRoll' });
      expect(JSON.stringify(view)).not.toContain('computerDiceCount');
    }
  });
});
