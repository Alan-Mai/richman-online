// Fits board positions into a screen rectangle. Board.pos units differ between maps (grid cells
// for the built-in board, pixels for converted maps), so everything is scaled uniformly.
import type { Point } from '@richman/shared';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BoardLayout {
  /** Screen pixels per board unit. */
  scale: number;
  /** Size of one tile on screen: the smallest distance between two tiles. */
  tileSize: number;
  toScreen: (p: Point) => Point;
}

/** Smallest distance between two distinct points; 1 when there are fewer than two. */
export function minSpacing(points: readonly Point[]): number {
  let best = Infinity;
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const a = points[i]!;
      const b = points[j]!;
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d > 0 && d < best) best = d;
    }
  }
  return best === Infinity ? 1 : best;
}

/**
 * Scales the points uniformly so that every tile (a square of minSpacing around each point) fits
 * inside `area`, and centres the result.
 */
export function layoutBoard(points: readonly Point[], area: Rect): BoardLayout {
  const spacing = minSpacing(points);
  const half = spacing / 2;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = (points.length ? Math.min(...xs) : 0) - half;
  const maxX = (points.length ? Math.max(...xs) : 0) + half;
  const minY = (points.length ? Math.min(...ys) : 0) - half;
  const maxY = (points.length ? Math.max(...ys) : 0) + half;

  const scale = Math.max(0, Math.min(area.width / (maxX - minX), area.height / (maxY - minY)));
  const offsetX = area.x + (area.width - (maxX - minX) * scale) / 2 - minX * scale;
  const offsetY = area.y + (area.height - (maxY - minY) * scale) / 2 - minY * scale;
  return {
    scale,
    tileSize: spacing * scale,
    toScreen: (p) => ({ x: offsetX + p.x * scale, y: offsetY + p.y * scale }),
  };
}
