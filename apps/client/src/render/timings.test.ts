import { describe, expect, it } from 'vitest';
import {
  AUCTION,
  auctionActionMs,
  DEFAULT_GAME_SPEED,
  FRAME_MS,
  GAME_SPEEDS,
  MOVE,
  frameScale,
  isGameSpeed,
  stepFrames,
  walkStepMs,
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

describe('walkStepMs', () => {
  it('is whole frames at the chosen speed', () => {
    const frames = stepFrames(MOVE.pxPerBoardUnit, MOVE.walkPxPerFrame);
    for (const speed of GAME_SPEEDS) expect(walkStepMs(1, speed)).toBe(frames * FRAME_MS[speed]);
  });

  it('takes longer for farther tiles', () => {
    expect(walkStepMs(Math.SQRT2, DEFAULT_GAME_SPEED)).toBeGreaterThan(
      walkStepMs(1, DEFAULT_GAME_SPEED),
    );
  });
});

describe('game speed', () => {
  it('gets faster from 0 to 3', () => {
    const lengths = GAME_SPEEDS.map((s) => FRAME_MS[s]);
    expect([...lengths].sort((a, b) => b - a)).toEqual(lengths);
  });

  it('scales durations relative to the default speed', () => {
    expect(frameScale(DEFAULT_GAME_SPEED)).toBe(1);
    expect(frameScale(0)).toBeGreaterThan(1);
    expect(frameScale(3)).toBeLessThan(1);
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
