// Movement along the board's links (docs/GAME_RULES.md §2), shared by real moves and the computer's
// preview.
import type { Board } from './board';
import type { TileIndex } from './ids';
import { nextInt, type RngState } from './rng';
import { at } from './update';

/**
 * Where one step from `position` leads, having come from `prev` (docs/GAME_RULES.md §2): any link
 * that is not blocked and does not lead back to prev; a random one of them at a fork; back to prev
 * at a dead end. Only forks draw from the RNG.
 */
export function stepFrom(
  board: Board,
  position: TileIndex,
  prev: TileIndex,
  rng: RngState,
): { to: TileIndex; rng: RngState } {
  const candidates = at(board.tiles, position)
    .links.filter((link) => link.blocked !== true && link.to !== prev)
    .map((link) => link.to);
  if (candidates.length === 0) {
    return { to: prev, rng };
  }
  if (candidates.length === 1) {
    return { to: at(candidates, 0), rng };
  }
  const [pick, next] = nextInt(rng, candidates.length);
  return { to: at(candidates, pick), rng: next };
}

/**
 * The tiles `steps` moves from `tile` would step on, in order, walking as a real move does
 * (stepFrom): random at forks, back at dead ends.
 */
export function previewPath(
  board: Board,
  tile: TileIndex,
  prev: TileIndex,
  steps: number,
  rng: RngState,
): { path: TileIndex[]; rng: RngState } {
  const path: TileIndex[] = [];
  let here = tile;
  let from = prev;
  let current = rng;
  for (let i = 0; i < steps; i++) {
    const next = stepFrom(board, here, from, current);
    path.push(next.to);
    from = here;
    here = next.to;
    current = next.rng;
  }
  return { path, rng: current };
}
