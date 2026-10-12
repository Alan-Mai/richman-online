import { describe, expect, it } from 'vitest';
import { prevOf, validateBoard, type Board, type TileDef } from './board';
import { DEFAULT_RULE_CONFIG } from './config';

function blank(next: number[]): TileDef {
  return { kind: 'blank', name: 'B', next, pos: { x: 0, y: 0 } };
}

function property(next: number[], price = 100, rentTable?: number[]): TileDef {
  const tile: TileDef = { kind: 'property', name: 'P', price, next, pos: { x: 0, y: 0 } };
  return rentTable ? { ...tile, rentTable } : tile;
}

function board(tiles: TileDef[], start = 0): Board {
  return { id: 'b', name: 'B', tiles, start };
}

/** A 4-tile loop 0 -> 1 -> 2 -> 3 -> 0. */
function loop(): TileDef[] {
  return [blank([1]), property([2]), property([3]), blank([0])];
}

describe('validateBoard', () => {
  it('accepts a simple loop', () => {
    expect(validateBoard(board(loop()), DEFAULT_RULE_CONFIG)).toEqual([]);
  });

  it('rejects an empty board', () => {
    expect(validateBoard(board([]), DEFAULT_RULE_CONFIG)).toContainEqual({ reason: 'empty' });
  });

  it('rejects a start outside the board', () => {
    expect(validateBoard(board(loop(), 4), DEFAULT_RULE_CONFIG)).toContainEqual({
      reason: 'startOutOfRange',
    });
    expect(validateBoard(board(loop(), 0.5), DEFAULT_RULE_CONFIG)).toContainEqual({
      reason: 'startOutOfRange',
    });
  });

  it('rejects next indices outside the board', () => {
    const tiles = loop();
    tiles[3] = blank([4]);
    expect(validateBoard(board(tiles), DEFAULT_RULE_CONFIG)).toContainEqual({
      reason: 'nextOutOfRange',
      tile: 3,
    });
  });

  it('rejects forks and dead ends', () => {
    const fork = loop();
    fork[1] = property([2, 3]);
    expect(validateBoard(board(fork), DEFAULT_RULE_CONFIG)).toContainEqual({
      reason: 'fork',
      tile: 1,
    });

    const deadEnd = loop();
    deadEnd[3] = blank([]);
    expect(validateBoard(board(deadEnd), DEFAULT_RULE_CONFIG)).toContainEqual({
      reason: 'deadEnd',
      tile: 3,
    });
  });

  it('rejects tiles with several predecessors', () => {
    // 0 -> 1 -> 2 -> 1: tile 1 has predecessors 0 and 2, tile 0 has none.
    const tiles = [blank([1]), property([2]), property([1])];
    const errors = validateBoard(board(tiles), DEFAULT_RULE_CONFIG);
    expect(errors).toContainEqual({ reason: 'multiplePredecessors', tile: 1 });
    expect(errors).toContainEqual({ reason: 'noPredecessor', tile: 0 });
  });

  it('rejects tiles not on the loop through start', () => {
    // Two separate loops: 0 <-> 1 and 2 <-> 3.
    const tiles = [blank([1]), property([0]), property([3]), blank([2])];
    const errors = validateBoard(board(tiles), DEFAULT_RULE_CONFIG);
    expect(errors).toContainEqual({ reason: 'unreachable', tile: 2 });
    expect(errors).toContainEqual({ reason: 'unreachable', tile: 3 });
  });

  it('rejects non-positive or fractional prices', () => {
    const tiles = loop();
    tiles[1] = property([2], 0);
    tiles[2] = property([3], 10.5);
    const errors = validateBoard(board(tiles), DEFAULT_RULE_CONFIG);
    expect(errors).toContainEqual({ reason: 'invalidPrice', tile: 1 });
    expect(errors).toContainEqual({ reason: 'invalidPrice', tile: 2 });
  });

  it('checks rentTable against maxLevel', () => {
    const levels = DEFAULT_RULE_CONFIG.maxLevel + 1;
    const ok = loop();
    ok[1] = property([2], 100, Array<number>(levels).fill(5));
    expect(validateBoard(board(ok), DEFAULT_RULE_CONFIG)).toEqual([]);

    const short = loop();
    short[1] = property([2], 100, [1, 2]);
    expect(validateBoard(board(short), DEFAULT_RULE_CONFIG)).toContainEqual({
      reason: 'rentTableLength',
      tile: 1,
    });
    expect(
      validateBoard(board(short), {
        ...DEFAULT_RULE_CONFIG,
        maxLevel: 1,
        rentPercentByLevel: [0, 0],
      }),
    ).toEqual([]);

    const negative = loop();
    negative[1] = property([2], 100, [...Array<number>(levels - 1).fill(5), -1]);
    expect(validateBoard(board(negative), DEFAULT_RULE_CONFIG)).toContainEqual({
      reason: 'invalidRentTable',
      tile: 1,
    });
  });
});

describe('prevOf', () => {
  it('inverts next', () => {
    expect(prevOf(board(loop()))).toEqual([[3], [0], [1], [2]]);
  });

  it('ignores out-of-range next entries', () => {
    expect(prevOf(board([blank([0, 5])]))).toEqual([[0]]);
  });
});
