import { describe, expect, it } from 'vitest';
import { validateBoard } from '../board';
import { DEFAULT_RULE_CONFIG } from '../config';
import { TEST_LOOP_BOARD } from './test-loop';

describe('TEST_LOOP_BOARD', () => {
  it('is a valid board', () => {
    expect(validateBoard(TEST_LOOP_BOARD, DEFAULT_RULE_CONFIG)).toEqual([]);
  });

  it('is a 20-tile loop with 16 properties, two blank corners and two bank corners', () => {
    const { tiles } = TEST_LOOP_BOARD;
    expect(tiles).toHaveLength(20);
    expect(tiles.filter((t) => t.kind === 'property')).toHaveLength(16);
    expect(
      tiles.map((t, i) => (t.kind === 'property' ? null : [i, t.kind])).filter(Boolean),
    ).toEqual([
      [0, 'blank'],
      [5, 'bank'],
      [10, 'blank'],
      [15, 'bank'],
    ]);
  });

  it('links each tile to its clockwise neighbour first, then the one behind', () => {
    const { tiles } = TEST_LOOP_BOARD;
    const n = tiles.length;
    tiles.forEach((tile, i) => {
      expect(tile.links).toEqual([{ to: (i + 1) % n }, { to: (i + n - 1) % n }]);
      const nextTile = tiles[(i + 1) % n];
      const step =
        Math.abs(tile.pos.x - (nextTile?.pos.x ?? NaN)) +
        Math.abs(tile.pos.y - (nextTile?.pos.y ?? NaN));
      expect(step).toBe(1);
    });
  });

  it('puts each side on one street of its own', () => {
    const { tiles } = TEST_LOOP_BOARD;
    const streets = [0, 1, 2, 3].map(
      (side) => new Set(tiles.slice(side * 5 + 1, side * 5 + 5).map((tile) => tile.name)),
    );
    for (const street of streets) expect(street.size).toBe(1);
    expect(new Set(streets.flatMap((street) => [...street])).size).toBe(4);
  });

  it('gives every property its own upgrade cost and strictly rising rents', () => {
    for (const tile of TEST_LOOP_BOARD.tiles) {
      if (tile.kind !== 'property') continue;
      expect(tile.upgradeCost).toBeGreaterThan(0);
      expect(tile.rents).toHaveLength(DEFAULT_RULE_CONFIG.maxLevel + 1);
      tile.rents.slice(1).forEach((rent, i) => expect(rent).toBeGreaterThan(tile.rents[i] ?? 0));
    }
  });
});
