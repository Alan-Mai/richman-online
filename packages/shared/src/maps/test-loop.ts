// Built-in test map: an original 20-tile loop around the edge of a 6x6 grid.
// All names and prices are made up for this project; nothing comes from the original game.
import type { Board, Point, TileDef } from '../board';

const SIDE = 5; // steps per side of the 6x6 grid edge
const TILE_COUNT = SIDE * 4;

/** Property prices, one row per side, clockwise from the start corner. */
const PRICES: readonly (readonly number[])[] = [
  [1000, 1000, 1200, 1200],
  [1600, 1600, 1800, 1800],
  [2200, 2200, 2400, 2400],
  [2800, 2800, 3000, 3000],
];

const CORNER_NAMES = ['起點', '測試空地 A', '測試空地 B', '測試空地 C'] as const;

/** Clockwise from the top-left corner: top row, right column, bottom row, left column. */
function gridPos(i: number): Point {
  const side = Math.floor(i / SIDE);
  const offset = i % SIDE;
  switch (side) {
    case 0:
      return { x: offset, y: 0 };
    case 1:
      return { x: SIDE, y: offset };
    case 2:
      return { x: SIDE - offset, y: SIDE };
    default:
      return { x: 0, y: SIDE - offset };
  }
}

function buildTiles(): TileDef[] {
  const tiles: TileDef[] = [];
  let propertyNumber = 0;
  for (let i = 0; i < TILE_COUNT; i++) {
    const side = Math.floor(i / SIDE);
    const offset = i % SIDE;
    // Clockwise neighbour first, then the one behind (testing helpers rely on that order).
    const links = [{ to: (i + 1) % TILE_COUNT }, { to: (i + TILE_COUNT - 1) % TILE_COUNT }];
    const pos = gridPos(i);
    if (offset === 0) {
      tiles.push({ kind: 'blank', name: CORNER_NAMES[side] ?? '', links, pos });
    } else {
      propertyNumber += 1;
      const price = PRICES[side]?.[offset - 1] ?? 0;
      tiles.push({ kind: 'property', name: `測試路 ${propertyNumber}`, price, links, pos });
    }
  }
  return tiles;
}

export const TEST_LOOP_BOARD: Board = {
  id: 'test-loop',
  name: '測試環狀地圖',
  tiles: buildTiles(),
  start: 0,
};
