// Animation pacing, in one place. The structure follows the original game (docs/GAME_RULES.md
// section 10): a frame length chosen by the game speed setting, and per-step frame counts that
// depend on the distance between tiles. Values marked "project value" are our own defaults, not
// the original's; the original tables will come from the local export (ROADMAP).

/** Game speed setting, 0 (slowest) to 3 (fastest), like the original's four steps. */
export const GAME_SPEEDS = [0, 1, 2, 3] as const;
export type GameSpeed = (typeof GAME_SPEEDS)[number];

export const DEFAULT_GAME_SPEED: GameSpeed = 2;

/** Length of one animation frame in milliseconds, per game speed. Project values. */
export const FRAME_MS: Readonly<Record<GameSpeed, number>> = { 0: 110, 1: 75, 2: 45, 3: 25 };

export const MOVE = {
  /**
   * Map pixels per board unit. Built-in boards sit on a 1-unit grid, so this is a representative
   * spacing between neighbouring tiles. Project value.
   */
  pxPerBoardUnit: 56,
  /** Pixels per frame while walking. Project value; vehicles come with the engine rework. */
  walkPxPerFrame: 9,
} as const;

/** Frames for one step: the original formula, at least one frame. */
export function stepFrames(distancePx: number, pxPerFrame: number): number {
  return Math.max(1, Math.trunc(distancePx / pxPerFrame));
}

/** Milliseconds for one walking step between tiles `boardDistance` board units apart. */
export function walkStepMs(boardDistance: number, speed: GameSpeed): number {
  return stepFrames(boardDistance * MOVE.pxPerBoardUnit, MOVE.walkPxPerFrame) * FRAME_MS[speed];
}

/** Factor for durations given at the default game speed. */
export function frameScale(speed: GameSpeed): number {
  return FRAME_MS[speed] / FRAME_MS[DEFAULT_GAME_SPEED];
}

/**
 * Milliseconds at the default game speed; they scale with the frame length. Project values (the
 * original's dice animation length lives in its animation files).
 */
export const DURATIONS = {
  /** Current player's token pulses when the turn starts. */
  turnStart: 350,
  /**
   * A player's token drops onto the board on their first turn. Not from the original: how the
   * original shows a player appearing is checked when its animation tables are exported (E0).
   */
  placed: 500,
  /** Dice tumble before the result shows. */
  diceRoll: 700,
  /** Floating money / status text rises and fades. */
  float: 750,
  /** Minimum pause after buying or upgrading (runs alongside the floating text). */
  property: 450,
  /** Pause after the game ends, before the result dialog. */
  gameEnd: 600,
  /**
   * A property goes up for auction, and one with nobody left to buy it is passed. Not from the
   * original, whose auction dialog opens and closes with its own animations (checked with the
   * animation tables, E0).
   */
  auctionOpen: 700,
  auctionUnsold: 600,
  /**
   * One bid, pass or withdrawal stays readable before the next. Not from the original: there each
   * bidder's character plays a short animation from its animation files (checked with the animation
   * tables, E0a).
   */
  auctionBid: 600,
} as const;

/** Fixed waits taken from the original code; the game speed does not change them. */
export const FIXED_MS = {
  /** Result stays on screen after the dice stop. */
  diceHold: 500,
  /** Whole bankruptcy animation, including its floating text. */
  bankrupt: 2000,
  /** After a sale the original waits this long, hands the property over, and waits again. */
  auctionSale: 1000,
} as const;

/** Playback speed multiplier while Space is held. Not in the original. */
export const FAST_SPEED = 4;

export function isGameSpeed(value: unknown): value is GameSpeed {
  return GAME_SPEEDS.some((s) => s === value);
}
