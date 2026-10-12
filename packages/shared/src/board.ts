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
