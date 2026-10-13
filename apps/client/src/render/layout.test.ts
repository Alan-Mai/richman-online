import { TEST_LOOP_BOARD, type Point } from '@richman/shared';
import { describe, expect, it } from 'vitest';
import { layoutBoard, minSpacing, type Rect } from './layout';

const area: Rect = { x: 10, y: 20, width: 800, height: 600 };

function bounds(points: Point[], tileSize: number) {
  const half = tileSize / 2;
  return {
    left: Math.min(...points.map((p) => p.x)) - half,
    right: Math.max(...points.map((p) => p.x)) + half,
    top: Math.min(...points.map((p) => p.y)) - half,
    bottom: Math.max(...points.map((p) => p.y)) + half,
  };
}

describe('minSpacing', () => {
  it('is the smallest non-zero distance', () => {
    expect(
      minSpacing([
        { x: 0, y: 0 },
        { x: 3, y: 4 },
        { x: 0, y: 2 },
      ]),
    ).toBe(2);
  });

  it('ignores duplicate points and defaults to 1', () => {
    expect(
      minSpacing([
        { x: 1, y: 1 },
        { x: 1, y: 1 },
      ]),
    ).toBe(1);
    expect(minSpacing([])).toBe(1);
  });
});

describe('layoutBoard', () => {
  const points = TEST_LOOP_BOARD.tiles.map((t) => t.pos);

  it('keeps every tile inside the area and centres the board', () => {
    const layout = layoutBoard(points, area);
    const screen = points.map(layout.toScreen);
    const b = bounds(screen, layout.tileSize);
    const eps = 1e-9;
    expect(b.left).toBeGreaterThanOrEqual(area.x - eps);
    expect(b.top).toBeGreaterThanOrEqual(area.y - eps);
    expect(b.right).toBeLessThanOrEqual(area.x + area.width + eps);
    expect(b.bottom).toBeLessThanOrEqual(area.y + area.height + eps);
    expect((b.left + b.right) / 2).toBeCloseTo(area.x + area.width / 2);
    expect((b.top + b.bottom) / 2).toBeCloseTo(area.y + area.height / 2);
  });

  it('fills the limiting dimension', () => {
    const layout = layoutBoard(points, area);
    const b = bounds(points.map(layout.toScreen), layout.tileSize);
    // The 6x6 grid is square, so the 600 px height limits it.
    expect(b.bottom - b.top).toBeCloseTo(600);
    expect(layout.tileSize).toBeCloseTo(100);
  });

  it('scales uniformly regardless of the units', () => {
    const pixels = points.map((p) => ({ x: p.x * 72 + 500, y: p.y * 72 - 30 }));
    const a = layoutBoard(points, area);
    const b = layoutBoard(pixels, area);
    expect(b.tileSize).toBeCloseTo(a.tileSize);
    points.forEach((p, i) => {
      expect(b.toScreen(pixels[i]!).x).toBeCloseTo(a.toScreen(p).x);
      expect(b.toScreen(pixels[i]!).y).toBeCloseTo(a.toScreen(p).y);
    });
  });

  it('handles an empty area and a single point', () => {
    expect(layoutBoard(points, { x: 0, y: 0, width: 0, height: 0 }).scale).toBe(0);
    const one = layoutBoard([{ x: 5, y: 5 }], area);
    expect(one.toScreen({ x: 5, y: 5 })).toEqual({ x: 410, y: 320 });
  });
});
