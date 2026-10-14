import { describe, expect, it } from 'vitest';
import { isLinked, validateBoard, type Board, type TileDef, type TileLink } from './board';
import { DEFAULT_RULE_CONFIG } from './config';

type LinkSpec = number | TileLink;

const toLinks = (links: LinkSpec[]): TileLink[] =>
  links.map((link) => (typeof link === 'number' ? { to: link } : link));

function blank(links: LinkSpec[]): TileDef {
  return { kind: 'blank', name: 'B', links: toLinks(links), pos: { x: 0, y: 0 } };
}

function property(links: LinkSpec[], price = 100, rentTable?: number[]): TileDef {
  const tile: TileDef = {
    kind: 'property',
    name: 'P',
    price,
    links: toLinks(links),
    pos: { x: 0, y: 0 },
  };
  return rentTable ? { ...tile, rentTable } : tile;
}

function board(tiles: TileDef[], start = 0): Board {
  return { id: 'b', name: 'B', tiles, start };
}

/** A 4-tile loop 0 - 1 - 2 - 3 - 0. */
function loop(): TileDef[] {
  return [blank([1, 3]), property([2, 0]), property([3, 1]), blank([0, 2])];
}

describe('validateBoard', () => {
  it('accepts a simple loop', () => {
    expect(validateBoard(board(loop()), DEFAULT_RULE_CONFIG)).toEqual([]);
  });

  it('accepts forks, dead ends and one-way blocks', () => {
    // Loop 0-1-2-3 with a spur 1-4-5 (5 is a dead end) and a one-way block from 2 to 3.
    const tiles = [
      blank([1, 3]),
      property([0, 2, 4]),
      property([1, { to: 3, blocked: true }]),
      blank([2, 0]),
      blank([1, 5]),
      property([4]),
    ];
    expect(validateBoard(board(tiles), DEFAULT_RULE_CONFIG)).toEqual([]);
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

  it('rejects links outside the board', () => {
    const tiles = loop();
    tiles[3] = blank([0, 2, 4]);
    expect(validateBoard(board(tiles), DEFAULT_RULE_CONFIG)).toContainEqual({
      reason: 'linkOutOfRange',
      tile: 3,
    });
  });

  it('rejects a tile linked to itself', () => {
    const tiles = loop();
    tiles[2] = property([3, 1, 2]);
    expect(validateBoard(board(tiles), DEFAULT_RULE_CONFIG)).toContainEqual({
      reason: 'selfLink',
      tile: 2,
    });
  });

  it('rejects the same neighbour listed twice', () => {
    const tiles = loop();
    tiles[1] = property([2, 0, { to: 2, blocked: true }]);
    expect(validateBoard(board(tiles), DEFAULT_RULE_CONFIG)).toContainEqual({
      reason: 'duplicateLink',
      tile: 1,
    });
  });

  it('rejects more than four links', () => {
    // Tile 0 is a hub linked to 1..5, each linked back to it.
    const tiles = [blank([1, 2, 3, 4, 5]), ...[1, 2, 3, 4, 5].map(() => blank([0]))];
    expect(validateBoard(board(tiles), DEFAULT_RULE_CONFIG)).toContainEqual({
      reason: 'tooManyLinks',
      tile: 0,
    });
  });

  it('rejects links that are not listed from the other end', () => {
    const tiles = loop();
    tiles[0] = blank([1, 3, 2]);
    expect(validateBoard(board(tiles), DEFAULT_RULE_CONFIG)).toContainEqual({
      reason: 'asymmetricLink',
      tile: 0,
    });
  });

  it('rejects tiles that cannot be left through any unblocked link', () => {
    const tiles = loop();
    tiles[3] = blank([
      { to: 0, blocked: true },
      { to: 2, blocked: true },
    ]);
    expect(validateBoard(board(tiles), DEFAULT_RULE_CONFIG)).toContainEqual({
      reason: 'noExit',
      tile: 3,
    });

    const isolated = [...loop(), blank([])];
    expect(validateBoard(board(isolated), DEFAULT_RULE_CONFIG)).toContainEqual({
      reason: 'noExit',
      tile: 4,
    });
  });

  it('rejects tiles not connected to start', () => {
    // Two separate pairs: 0 - 1 and 2 - 3.
    const tiles = [blank([1]), property([0]), property([3]), blank([2])];
    const errors = validateBoard(board(tiles), DEFAULT_RULE_CONFIG);
    expect(errors).toContainEqual({ reason: 'disconnected', tile: 2 });
    expect(errors).toContainEqual({ reason: 'disconnected', tile: 3 });
    expect(errors).not.toContainEqual({ reason: 'disconnected', tile: 1 });
  });

  it('rejects non-positive or fractional prices', () => {
    const tiles = loop();
    tiles[1] = property([2, 0], 0);
    tiles[2] = property([3, 1], 10.5);
    const errors = validateBoard(board(tiles), DEFAULT_RULE_CONFIG);
    expect(errors).toContainEqual({ reason: 'invalidPrice', tile: 1 });
    expect(errors).toContainEqual({ reason: 'invalidPrice', tile: 2 });
  });

  it('checks rentTable against maxLevel', () => {
    const levels = DEFAULT_RULE_CONFIG.maxLevel + 1;
    const ok = loop();
    ok[1] = property([2, 0], 100, Array<number>(levels).fill(5));
    expect(validateBoard(board(ok), DEFAULT_RULE_CONFIG)).toEqual([]);

    const short = loop();
    short[1] = property([2, 0], 100, [1, 2]);
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
    negative[1] = property([2, 0], 100, [...Array<number>(levels - 1).fill(5), -1]);
    expect(validateBoard(board(negative), DEFAULT_RULE_CONFIG)).toContainEqual({
      reason: 'invalidRentTable',
      tile: 1,
    });
  });
});

describe('isLinked', () => {
  it('sees blocked and unblocked links alike', () => {
    const tiles = loop();
    tiles[2] = property([{ to: 3, blocked: true }, 1]);
    const b = board(tiles);
    expect(isLinked(b, 2, 3)).toBe(true);
    expect(isLinked(b, 3, 2)).toBe(true);
    expect(isLinked(b, 0, 2)).toBe(false);
    expect(isLinked(b, 9, 0)).toBe(false);
  });
});
