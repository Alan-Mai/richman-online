import { VEHICLES, type OriginalTables } from '@richman/shared';
import { describe, expect, it } from 'vitest';
import {
  AUCTION,
  auctionActionMs,
  DEFAULT_GAME_SPEED,
  GAME_SPEEDS,
  MOVE,
  PROJECT_PACING,
  TIMER_TICK_MS,
  frameScale,
  isGameSpeed,
  pacingFromTables,
  stepFrames,
  stepMs,
} from './timings';

describe('stepFrames', () => {
  it('truncates distance over pixels per frame', () => {
    expect(stepFrames(50, 10)).toBe(5);
    expect(stepFrames(59, 10)).toBe(5);
    expect(stepFrames(60, 10)).toBe(6);
  });

  it('takes at least one frame', () => {
    expect(stepFrames(3, 10)).toBe(1);
    expect(stepFrames(0, 10)).toBe(1);
  });
});

/** Made-up tables, not the original's. */
const ANIMATION: OriginalTables['animation'] = {
  frameTicks: [7, 4, 2],
  stepPixels: { walk: 5, motorbike: 8, car: 11, temporary: 6 },
  diceAnimDelay: [1, 2, 3, 4],
};

describe('stepMs', () => {
  it('is whole frames at the chosen speed', () => {
    const frames = stepFrames(MOVE.pxPerBoardUnit, PROJECT_PACING.pxPerFrame.walk);
    for (const speed of GAME_SPEEDS) {
      expect(stepMs(1, 'walk', speed)).toBe(frames * PROJECT_PACING.frameMs[speed]);
    }
  });

  it('takes longer for farther tiles', () => {
    expect(stepMs(Math.SQRT2, 'walk', DEFAULT_GAME_SPEED)).toBeGreaterThan(
      stepMs(1, 'walk', DEFAULT_GAME_SPEED),
    );
  });

  it('is fastest by car and slowest on foot', () => {
    const [walk, motorbike, car] = VEHICLES.map((v) => stepMs(1, v, DEFAULT_GAME_SPEED));
    expect(walk).toBeGreaterThan(motorbike ?? 0);
    expect(motorbike).toBeGreaterThan(car ?? 0);
  });

  it("uses the original tables' frame lengths and pixels per frame", () => {
    const pacing = pacingFromTables(ANIMATION);
    // 56 px at 11 px per frame: 5 frames of 2 ticks.
    expect(stepMs(1, 'car', 2, pacing)).toBe(5 * 2 * TIMER_TICK_MS);
    // 56 px at 5 px per frame: 11 frames of 7 ticks.
    expect(stepMs(1, 'walk', 0, pacing)).toBe(11 * 7 * TIMER_TICK_MS);
    expect(stepMs(1, 'motorbike', 1, pacing)).toBe(7 * 4 * TIMER_TICK_MS);
  });
});

describe('pacingFromTables', () => {
  it('turns timer ticks into milliseconds, with a frame on every tick at speed 3', () => {
    expect(pacingFromTables(ANIMATION)).toEqual({
      source: 'original',
      frameMs: { 0: 140, 1: 80, 2: 40, 3: 20 },
      pxPerFrame: { walk: 5, motorbike: 8, car: 11 },
    });
  });

  it('takes a 0 as one tick', () => {
    const pacing = pacingFromTables({ ...ANIMATION, frameTicks: [0, 0, 0] });
    expect(pacing.frameMs).toEqual({ 0: 20, 1: 20, 2: 20, 3: 20 });
  });
});

describe('game speed', () => {
  it('gets faster from 0 to 3', () => {
    const lengths = GAME_SPEEDS.map((s) => PROJECT_PACING.frameMs[s]);
    expect([...lengths].sort((a, b) => b - a)).toEqual(lengths);
  });

  it('scales durations relative to the default speed', () => {
    expect(frameScale(DEFAULT_GAME_SPEED)).toBe(1);
    expect(frameScale(0)).toBeGreaterThan(1);
    expect(frameScale(3)).toBeLessThan(1);
    const original = pacingFromTables(ANIMATION);
    expect(frameScale(0, original)).toBe(140 / 40);
    expect(frameScale(3, original)).toBe(20 / 40);
  });

  it('recognises valid settings only', () => {
    expect(isGameSpeed(2)).toBe(true);
    expect(isGameSpeed(4)).toBe(false);
    expect(isGameSpeed('2')).toBe(false);
  });
});

describe('auctionActionMs', () => {
  it('uses the minimum without imported animations', () => {
    expect(auctionActionMs(null)).toBe(AUCTION.minActionTicks * AUCTION.tickMs);
  });

  it('lasts frames + 1 ticks when the raise animation is longer than the minimum', () => {
    expect(auctionActionMs(AUCTION.minActionTicks - 1)).toBe(
      AUCTION.minActionTicks * AUCTION.tickMs,
    );
    expect(auctionActionMs(AUCTION.minActionTicks + 4)).toBe(
      (AUCTION.minActionTicks + 5) * AUCTION.tickMs,
    );
  });
});
