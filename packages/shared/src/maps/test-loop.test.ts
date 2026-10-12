import { describe, expect, it } from 'vitest';
import { validateBoard } from '../board';
import { DEFAULT_RULE_CONFIG } from '../config';
import { TEST_LOOP_BOARD } from './test-loop';

describe('TEST_LOOP_BOARD', () => {
  it('is a valid Phase 2 board', () => {
    expect(validateBoard(TEST_LOOP_BOARD, DEFAULT_RULE_CONFIG)).toEqual([]);
  });

  it('is a 20-tile loop with blank corners and 16 properties', () => {
    const { tiles } = TEST_LOOP_BOARD;
    expect(tiles).toHaveLength(20);
    expect(TEST_LOOP_BOARD.start).toBe(0);
    expect(tiles.filter((t) => t.kind === 'property')).toHaveLength(16);
    for (const corner of [0, 5, 10, 15]) {
      expect(tiles[corner]?.kind).toBe('blank');
    }
  });

  it('walks forward clockwise around the 6x6 grid edge', () => {
    const { tiles } = TEST_LOOP_BOARD;
    tiles.forEach((tile, i) => {
      expect(tile.next).toEqual([(i + 1) % tiles.length]);
      const nextTile = tiles[(i + 1) % tiles.length];
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
