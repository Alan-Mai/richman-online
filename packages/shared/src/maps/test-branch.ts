// Built-in test map with forks, a dead-end spur and one-way blocks: TEST_LOOP_BOARD plus a
// one-way road through the middle and a spur off the left side. Names and prices are made up for
// this project; nothing comes from the original game.
import type { Board, TileDef, TileLink } from '../board';
import type { TileIndex } from '../ids';
import { TEST_LOOP_BOARD, testLoopAmounts } from './test-loop';

/** Extra tiles, appended after the 20 loop tiles (indices 20..25). */
const EXTRA: readonly TileDef[] = [
  // Middle road from the top edge (tile 3) down to the bottom edge (tile 12), one way downward.
  { kind: 'blank', name: '測試中路口', links: [], pos: { x: 3, y: 1 } },
  {
    kind: 'property',
    name: '測試中路 1',
    ...testLoopAmounts(1500, 0),
    links: [],
    pos: { x: 3, y: 2 },
  },
  {
    kind: 'property',
    name: '測試中路 2',
    ...testLoopAmounts(2600, 1),
    links: [],
    pos: { x: 3, y: 3 },
  },
  { kind: 'blank', name: '測試中路尾', links: [], pos: { x: 3, y: 4 } },
  // Dead-end spur off the left edge (tile 17).
  { kind: 'property', name: '測試巷', ...testLoopAmounts(900, 0), links: [], pos: { x: 1, y: 3 } },
  { kind: 'blank', name: '測試巷底', links: [], pos: { x: 2, y: 3 } },
];

/** Undirected roads; `blockedFrom` names the end that may not be left through this road. */
const ROADS: readonly { a: TileIndex; b: TileIndex; blockedFrom?: TileIndex }[] = [
  { a: 3, b: 20, blockedFrom: 20 },
  { a: 20, b: 21 },
  { a: 21, b: 22 },
  { a: 22, b: 23 },
  { a: 23, b: 12, blockedFrom: 12 },
  { a: 17, b: 24 },
  { a: 24, b: 25 },
];

function buildTiles(): TileDef[] {
  const tiles = [...TEST_LOOP_BOARD.tiles, ...EXTRA];
  const links: TileLink[][] = tiles.map((tile) => [...tile.links]);
  for (const { a, b, blockedFrom } of ROADS) {
    links[a]?.push(blockedFrom === a ? { to: b, blocked: true } : { to: b });
    links[b]?.push(blockedFrom === b ? { to: a, blocked: true } : { to: a });
  }
  return tiles.map((tile, i) => ({ ...tile, links: links[i] ?? [] }));
}

export const TEST_BRANCH_BOARD: Board = {
  id: 'test-branch',
  name: '分岔測試地圖',
  tiles: buildTiles(),
};
