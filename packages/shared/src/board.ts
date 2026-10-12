import type { RuleConfig } from './config';
import type { TileIndex } from './ids';

/** Render position; the rule engine ignores it. */
export interface Point {
  x: number;
  y: number;
}

interface TileBase {
  /** Map content, not UI text, so it is not routed through i18n. */
  name: string;
  /**
   * Directed successors: where a player facing 'forward' moves next. Walking 'backward' uses the
   * inverse (prevOf). More than one entry is a fork; Phase 2 boards must not have forks.
   */
  next: readonly TileIndex[];
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

/** Special tiles (bank, hospital, ...) are added here as new kinds. */
export type TileDef = PropertyTileDef | BlankTileDef;

export interface Board {
  id: string;
  name: string;
  tiles: readonly TileDef[];
  /** Where every player starts; also the trigger tile for RuleConfig.passStartBonus. */
  start: TileIndex;
}

export type BoardError =
  | { reason: 'empty' }
  | { reason: 'startOutOfRange' }
  | {
      reason:
        | 'nextOutOfRange'
        | 'deadEnd'
        | 'fork'
        | 'noPredecessor'
        | 'multiplePredecessors'
        | 'unreachable'
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

/** Predecessors of every tile (the inverse of next); used to walk backward. */
export function prevOf(board: Board): TileIndex[][] {
  const prev: TileIndex[][] = board.tiles.map(() => []);
  board.tiles.forEach((tile, from) => {
    for (const to of tile.next) {
      prev[to]?.push(from);
    }
  });
  return prev;
}

/**
 * Phase 2 board rules: every tile has exactly one successor and one predecessor, and they form a
 * single loop through start (no forks). Returns every problem found; empty means valid.
 */
export function validateBoard(board: Board, config: RuleConfig): BoardError[] {
  const { tiles } = board;
  if (tiles.length === 0) {
    return [{ reason: 'empty' }];
  }

  const errors: BoardError[] = [];
  if (!isTileIndex(board.start, tiles.length)) {
    errors.push({ reason: 'startOutOfRange' });
  }

  tiles.forEach((tile, i) => {
    if (tile.next.length === 0) {
      errors.push({ reason: 'deadEnd', tile: i });
    } else if (tile.next.length > 1) {
      errors.push({ reason: 'fork', tile: i });
    }
    if (!tile.next.every((to) => isTileIndex(to, tiles.length))) {
      errors.push({ reason: 'nextOutOfRange', tile: i });
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

  prevOf(board).forEach((prev, i) => {
    if (prev.length === 0) {
      errors.push({ reason: 'noPredecessor', tile: i });
    } else if (prev.length > 1) {
      errors.push({ reason: 'multiplePredecessors', tile: i });
    }
  });

  // With one successor and one predecessor everywhere, the tiles form disjoint cycles;
  // only the cycle through start is playable.
  if (errors.length === 0) {
    const onLoop = new Set<TileIndex>();
    let current = board.start;
    while (!onLoop.has(current)) {
      onLoop.add(current);
      current = tiles[current]?.next[0] ?? board.start;
    }
    tiles.forEach((_, i) => {
      if (!onLoop.has(i)) {
        errors.push({ reason: 'unreachable', tile: i });
      }
    });
  }

  return errors;
}
