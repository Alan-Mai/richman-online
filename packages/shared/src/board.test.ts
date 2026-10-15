import { describe, expect, it } from 'vitest';
import {
  isLinked,
  isPlaceable,
  validateBoard,
  type Board,
  type PropertyTileDef,
  type TileDef,
  type TileLink,
} from './board';
import { DEFAULT_RULE_CONFIG } from './config';

type LinkSpec = number | TileLink;

const toLinks = (links: LinkSpec[]): TileLink[] =>
  links.map((link) => (typeof link === 'number' ? { to: link } : link));

function blank(links: LinkSpec[]): TileDef {
  return { kind: 'blank', name: 'B', links: toLinks(links), pos: { x: 0, y: 0 } };
}

const RENTS = [5, 10, 20, 40, 80, 160];

function property(
  links: LinkSpec[],
  { price = 100, upgradeCost = 50, rents = RENTS }: Partial<PropertyTileDef> = {},
): TileDef {
  return {
    kind: 'property',
    name: 'P',
    price,
    upgradeCost,
    rents,
    links: toLinks(links),
    pos: { x: 0, y: 0 },
  };
}

function board(tiles: TileDef[]): Board {
  return { id: 'b', name: 'B', tiles };
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
    tiles[1] = property([2, 0], { price: 0 });
    tiles[2] = property([3, 1], { price: 10.5 });
    const errors = validateBoard(board(tiles), DEFAULT_RULE_CONFIG);
    expect(errors).toContainEqual({ reason: 'invalidPrice', tile: 1 });
    expect(errors).toContainEqual({ reason: 'invalidPrice', tile: 2 });
  });

  it('accepts a zero upgrade cost and zero rents', () => {
    const tiles = loop();
    tiles[1] = property([2, 0], { upgradeCost: 0, rents: [0, 0, 0, 0, 0, 0] });
    expect(validateBoard(board(tiles), DEFAULT_RULE_CONFIG)).toEqual([]);
  });

  it('rejects negative or fractional upgrade costs', () => {
    const tiles = loop();
    tiles[1] = property([2, 0], { upgradeCost: -1 });
    tiles[2] = property([3, 1], { upgradeCost: 0.5 });
    const errors = validateBoard(board(tiles), DEFAULT_RULE_CONFIG);
    expect(errors).toContainEqual({ reason: 'invalidUpgradeCost', tile: 1 });
    expect(errors).toContainEqual({ reason: 'invalidUpgradeCost', tile: 2 });
  });

  it('requires one rent per level 0..maxLevel', () => {
    const tiles = loop();
    tiles[1] = property([2, 0], { rents: [1, 2] });
    tiles[2] = property([3, 1], { rents: [...RENTS, 320] });
    const errors = validateBoard(board(tiles), DEFAULT_RULE_CONFIG);
    expect(errors).toContainEqual({ reason: 'rentsLength', tile: 1 });
    expect(errors).toContainEqual({ reason: 'rentsLength', tile: 2 });
    expect(validateBoard(board(tiles), { ...DEFAULT_RULE_CONFIG, maxLevel: 1 })).toEqual([
      { reason: 'rentsLength', tile: 2 },
    ]);
  });

  it('rejects negative or fractional rents', () => {
    const tiles = loop();
    tiles[1] = property([2, 0], { rents: [5, 10, 20, 40, 80, -1] });
    tiles[2] = property([3, 1], { rents: [5, 10.5, 20, 40, 80, 160] });
    const errors = validateBoard(board(tiles), DEFAULT_RULE_CONFIG);
    expect(errors).toContainEqual({ reason: 'invalidRents', tile: 1 });
    expect(errors).toContainEqual({ reason: 'invalidRents', tile: 2 });
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

describe('placement tiles', () => {
  const tooFew = (count: number, required = DEFAULT_RULE_CONFIG.maxPlayers) => ({
    reason: 'tooFewPlacementTiles',
    count,
    required,
  });
  const unsupported = (links: LinkSpec[]): TileDef => ({
    kind: 'unsupported',
    feature: 'largeBuilding',
    name: 'U',
    links: toLinks(links),
    pos: { x: 0, y: 0 },
  });

  it('accepts exactly maxPlayers placeable tiles', () => {
    expect(loop()).toHaveLength(DEFAULT_RULE_CONFIG.maxPlayers);
    expect(validateBoard(board(loop()), DEFAULT_RULE_CONFIG)).toEqual([]);
  });

  it('rejects one placeable tile fewer than maxPlayers', () => {
    const tiles = loop();
    tiles[2] = { ...property([3, 1]), noRandomPlacement: true };
    expect(validateBoard(board(tiles), DEFAULT_RULE_CONFIG)).toEqual([tooFew(3)]);
  });

  it('does not count unsupported tiles', () => {
    const tiles = loop();
    tiles[1] = unsupported([2, 0]);
    expect(validateBoard(board(tiles), DEFAULT_RULE_CONFIG)).toEqual([tooFew(3)]);
  });

  it('does not count tiles without neighbours', () => {
    // Five tiles, but the fifth has no links (also reported as noExit and disconnected).
    const tiles = [...loop(), blank([])];
    tiles[0] = { ...blank([1, 3]), noRandomPlacement: true };
    expect(validateBoard(board(tiles), DEFAULT_RULE_CONFIG)).toContainEqual(tooFew(3));
  });

  it('requires as many as the configured maxPlayers', () => {
    const tiles = loop();
    tiles[0] = { ...blank([1, 3]), noRandomPlacement: true };
    tiles[1] = unsupported([2, 0]);
    const config = { ...DEFAULT_RULE_CONFIG, maxPlayers: 2 };
    expect(validateBoard(board(tiles), config)).toEqual([]);
    expect(validateBoard(board(tiles), { ...config, maxPlayers: 3 })).toEqual([tooFew(2, 3)]);
  });

  it('isPlaceable follows the same rules', () => {
    expect(isPlaceable(blank([1]))).toBe(true);
    expect(isPlaceable(property([1]))).toBe(true);
    expect(isPlaceable(blank([]))).toBe(false);
    expect(isPlaceable({ ...blank([1]), noRandomPlacement: true })).toBe(false);
    expect(isPlaceable({ ...blank([1]), noRandomPlacement: false })).toBe(true);
    expect(isPlaceable(unsupported([1]))).toBe(false);
    // Banks can be a random start, as in the original game (docs/GAME_RULES.md §4).
    expect(isPlaceable({ ...blank([1]), kind: 'bank' })).toBe(true);
  });
});
