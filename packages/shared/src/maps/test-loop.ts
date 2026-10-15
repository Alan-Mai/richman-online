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

/** Made-up rent templates: percent of the land price at levels 0..5. */
const RENT_PERCENTS = [
  [10, 30, 60, 100, 150, 200],
  [12, 32, 64, 100, 140, 190],
] as const;

/**
 * A property's own amounts: upgrade cost half the price, rents from the side's template
 * (alternating by side). Made up for this map.
 */
export function testLoopAmounts(
  price: number,
  side: number,
): { price: number; upgradeCost: number; rents: number[] } {
  const percents = RENT_PERCENTS[side % RENT_PERCENTS.length] ?? RENT_PERCENTS[0];
  return {
    price,
    upgradeCost: Math.floor(price / 2),
    rents: percents.map((percent) => Math.floor((price * percent) / 100)),
  };
}

/** Corners clockwise from the start; the second and fourth are banks. */
const CORNERS = [
  { kind: 'blank', name: '起點' },
  { kind: 'bank', name: '測試銀行 A' },
  { kind: 'blank', name: '測試空地' },
  { kind: 'bank', name: '測試銀行 B' },
] as const;

/** One street per side; rent adds up over the street an owner has (docs/GAME_RULES.md §3). */
const STREET_NAMES = ['測試北街', '測試東街', '測試南街', '測試西街'] as const;

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
  for (let i = 0; i < TILE_COUNT; i++) {
    const side = Math.floor(i / SIDE);
    const offset = i % SIDE;
    // Clockwise neighbour first, then the one behind (testing helpers rely on that order).
    const links = [{ to: (i + 1) % TILE_COUNT }, { to: (i + TILE_COUNT - 1) % TILE_COUNT }];
    const pos = gridPos(i);
    if (offset === 0) {
      tiles.push({ ...(CORNERS[side] ?? CORNERS[0]), links, pos });
    } else {
      const price = PRICES[side]?.[offset - 1] ?? 0;
      tiles.push({
        kind: 'property',
        name: STREET_NAMES[side] ?? '',
        ...testLoopAmounts(price, side),
        links,
        pos,
      });
    }
  }
  return tiles;
}

export const TEST_LOOP_BOARD: Board = {
  id: 'test-loop',
  name: '測試環狀地圖',
  tiles: buildTiles(),
  // Made-up holidays, so loan due dates have something to move past.
  holidays: [
    { date: { kind: 'solar', month: 4, day: 1 }, restDay: true, disabled: false, event: 0 },
  ],
};
