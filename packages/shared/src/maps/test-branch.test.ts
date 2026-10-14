import { describe, expect, it } from 'vitest';
import { validateBoard } from '../board';
import { DEFAULT_RULE_CONFIG } from '../config';
import { stepFrom } from '../engine';
import type { TileIndex } from '../ids';
import { scriptedRng } from '../testing';
import { TEST_BRANCH_BOARD } from './test-branch';

const { tiles } = TEST_BRANCH_BOARD;

/** Every next tile a player at `tile` (coming from `prev`) can reach in one step. */
function successors(tile: TileIndex, prev: TileIndex): TileIndex[] {
  const out = new Set<TileIndex>();
  const forks = tiles[tile]?.links.length ?? 0;
  for (let pick = 0; pick < forks; pick++) {
    try {
      out.add(stepFrom(TEST_BRANCH_BOARD, tile, prev, scriptedRng([pick])).to);
    } catch {
      // pick out of range for this fork
    }
  }
  return [...out];
}

describe('TEST_BRANCH_BOARD', () => {
  it('is a valid board', () => {
    expect(validateBoard(TEST_BRANCH_BOARD, DEFAULT_RULE_CONFIG)).toEqual([]);
  });

  it('has forks, dead ends and one-way blocks', () => {
    const exits = tiles.map((tile) => tile.links.filter((link) => link.blocked !== true).length);
    expect(exits.some((n) => n >= 3)).toBe(true);
    expect(tiles.some((tile) => tile.links.length === 1)).toBe(true);
    expect(tiles.some((tile) => tile.links.some((link) => link.blocked === true))).toBe(true);
  });

  it('lets a player reach every tile from tile 0 in every direction', () => {
    for (const { to: firstPrev } of tiles[0]?.links ?? []) {
      const seen = new Set<string>();
      const reached = new Set<TileIndex>([0]);
      const queue: [TileIndex, TileIndex][] = [[0, firstPrev]];
      for (let state = queue.pop(); state !== undefined; state = queue.pop()) {
        const [tile, prev] = state;
        for (const next of successors(tile, prev)) {
          const key = `${next}<${tile}`;
          if (!seen.has(key)) {
            seen.add(key);
            reached.add(next);
            queue.push([next, tile]);
          }
        }
      }
      expect(reached.size).toBe(tiles.length);
    }
  });

  it('places neighbours one grid step apart', () => {
    tiles.forEach((tile) => {
      for (const { to } of tile.links) {
        const other = tiles[to];
        const step =
          Math.abs(tile.pos.x - (other?.pos.x ?? NaN)) +
          Math.abs(tile.pos.y - (other?.pos.y ?? NaN));
        expect(step).toBe(1);
      }
    });
  });
});
