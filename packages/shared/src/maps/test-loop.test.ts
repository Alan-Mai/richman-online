import { describe, expect, it } from 'vitest';
import { validateBoard } from '../board';
import { DEFAULT_RULE_CONFIG } from '../config';
import { TEST_LOOP_BOARD } from './test-loop';

describe('TEST_LOOP_BOARD', () => {
  it('is a valid board', () => {
    expect(validateBoard(TEST_LOOP_BOARD, DEFAULT_RULE_CONFIG)).toEqual([]);
  });

  it('is a 20-tile loop with blank corners and 16 properties', () => {
    const { tiles } = TEST_LOOP_BOARD;
    expect(tiles).toHaveLength(20);
    expect(tiles.filter((t) => t.kind === 'property')).toHaveLength(16);
    for (const corner of [0, 5, 10, 15]) {
      expect(tiles[corner]?.kind).toBe('blank');
    }
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

  it('does not use rentTable', () => {
    for (const tile of TEST_LOOP_BOARD.tiles) {
      if (tile.kind === 'property') expect(tile.rentTable).toBeUndefined();
    }
  });
});
