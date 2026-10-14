import type { RuleConfig } from './config';
import type { TileIndex } from './ids';

/** Render position; the rule engine ignores it. */
export interface Point {
  x: number;
  y: number;
}

/**
 * One neighbour slot. Links are undirected: the board lists every link from both ends
 * (docs/GAME_RULES.md §2).
 */
export interface TileLink {
  to: TileIndex;
  /** One-way block: a player may not leave through this link, but may enter from the other end. */
  blocked?: boolean;
}

/** Original maps have four neighbour slots per tile. */
export const MAX_LINKS = 4;

interface TileBase {
  /** Map content, not UI text, so it is not routed through i18n. */
  name: string;
  /**
   * Neighbours, all of equal standing; there is no forward direction. Players remember the tile
   * they came from and never step straight back unless they hit a dead end.
   */
  links: readonly TileLink[];
  /** Never chosen as a player's random start (docs/GAME_RULES.md §1). */
  noRandomPlacement?: boolean;
  pos: Point;
}

export interface PropertyTileDef extends TileBase {
  kind: 'property';
  price: number;
  /**
   * Optional rent per level (length maxLevel + 1). When absent, rent is derived from
   * RuleConfig.rentPercentByLevel.
   */
  rentTable?: readonly number[];
}

export interface BlankTileDef extends TileBase {
  kind: 'blank';
}

/**
 * A placeholder for map content the engine does not implement yet, so a converted original map
 * says so explicitly instead of passing it off as a blank tile. Players walk over and stop on it
 * with no effect, and it is never a random start.
 */
export interface UnsupportedTileDef extends TileBase {
  kind: 'unsupported';
  /** What the tile stands for; the map converter warns about each one. */
  feature: 'largeBuilding';
}

/** Special tiles (bank, hospital, ...) are added here as new kinds. */
export type TileDef = PropertyTileDef | BlankTileDef | UnsupportedTileDef;

export interface Board {
  id: string;
  name: string;
  tiles: readonly TileDef[];
}

export type BoardError =
  | { reason: 'empty' }
  /** Fewer placeable tiles than RuleConfig.maxPlayers, so a random start could find none. */
  | { reason: 'tooFewPlacementTiles'; count: number; required: number }
  | {
      reason:
        | 'linkOutOfRange'
        | 'selfLink'
        | 'duplicateLink'
        | 'tooManyLinks'
        | 'asymmetricLink'
        | 'noExit'
        | 'disconnected'
        | 'invalidPrice'
        | 'rentTableLength'
        | 'invalidRentTable';
      tile: TileIndex;
    };

function isTileIndex(value: number, tileCount: number): boolean {
  return Number.isInteger(value) && value >= 0 && value < tileCount;
}

function isNonNegativeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

/** Whether `from` lists `to` as a neighbour (blocked or not). */
export function isLinked(board: Board, from: TileIndex, to: TileIndex): boolean {
  return board.tiles[from]?.links.some((link) => link.to === to) ?? false;
}

/**
 * Whether a player may be placed on this tile at random when it is free (docs/GAME_RULES.md §1):
 * it has a neighbour, is not flagged noRandomPlacement and is not an unsupported tile.
 */
export function isPlaceable(tile: TileDef): boolean {
  return tile.links.length > 0 && tile.noRandomPlacement !== true && tile.kind !== 'unsupported';
}

/**
 * Board rules (docs/GAME_RULES.md §1, §2): links are symmetric, at most MAX_LINKS per tile, every
 * tile can be left through at least one unblocked link, all tiles are connected, and there are at
 * least maxPlayers placeable tiles. Returns every problem found; empty means valid.
 */
export function validateBoard(board: Board, config: RuleConfig): BoardError[] {
  const { tiles } = board;
  if (tiles.length === 0) {
    return [{ reason: 'empty' }];
  }

  const errors: BoardError[] = [];

  tiles.forEach((tile, i) => {
    const targets = tile.links.map((link) => link.to);
    if (tile.links.length > MAX_LINKS) {
      errors.push({ reason: 'tooManyLinks', tile: i });
    }
    if (!targets.every((to) => isTileIndex(to, tiles.length))) {
      errors.push({ reason: 'linkOutOfRange', tile: i });
    }
    if (targets.includes(i)) {
      errors.push({ reason: 'selfLink', tile: i });
    }
    if (new Set(targets).size !== targets.length) {
      errors.push({ reason: 'duplicateLink', tile: i });
    }
    if (
      targets.some((to) => to !== i && isTileIndex(to, tiles.length) && !isLinked(board, to, i))
    ) {
      errors.push({ reason: 'asymmetricLink', tile: i });
    }
    if (!tile.links.some((link) => link.blocked !== true)) {
      errors.push({ reason: 'noExit', tile: i });
    }
    if (tile.kind === 'property') {
      if (!Number.isSafeInteger(tile.price) || tile.price <= 0) {
        errors.push({ reason: 'invalidPrice', tile: i });
      }
      if (tile.rentTable !== undefined) {
        if (tile.rentTable.length !== config.maxLevel + 1) {
          errors.push({ reason: 'rentTableLength', tile: i });
        }
        if (!tile.rentTable.every(isNonNegativeInteger)) {
          errors.push({ reason: 'invalidRentTable', tile: i });
        }
      }
    }
  });

  // Connectivity ignores blocks: a blocked link can still be walked from the other end, and dead
  // ends turn players around. Tiles not reachable from tile 0 are reported.
  const seen = new Set<TileIndex>([0]);
  const queue: TileIndex[] = [0];
  for (let tile = queue.pop(); tile !== undefined; tile = queue.pop()) {
    for (const { to } of tiles[tile]?.links ?? []) {
      if (isTileIndex(to, tiles.length) && !seen.has(to)) {
        seen.add(to);
        queue.push(to);
      }
    }
  }
  tiles.forEach((_, i) => {
    if (!seen.has(i)) {
      errors.push({ reason: 'disconnected', tile: i });
    }
  });

  // Placing skips tiles where someone stands, at most maxPlayers - 1 of them, so this many
  // placeable tiles always leave one free (B0-g: the original game does not handle zero).
  const placeable = tiles.filter(isPlaceable).length;
  if (placeable < config.maxPlayers) {
    errors.push({ reason: 'tooFewPlacementTiles', count: placeable, required: config.maxPlayers });
  }

  return errors;
}
