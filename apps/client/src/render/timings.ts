// Animation pacing, in one place. The structure follows the original game (docs/GAME_RULES.md
// section 10): a frame length chosen by the game speed setting, and per-step frame counts that
// depend on the distance between tiles and the vehicle. Values marked "project value" are our own
// defaults, not the original's; with an imported tables.json the original tables replace them.
import type { OriginalTables, Vehicle } from '@richman/shared';

/** Game speed setting, 0 (slowest) to 3 (fastest), like the original's four steps. */
export const GAME_SPEEDS = [0, 1, 2, 3] as const;
export type GameSpeed = (typeof GAME_SPEEDS)[number];

export const DEFAULT_GAME_SPEED: GameSpeed = 2;

/** The original's animation timer period; logical frames are whole numbers of its ticks. */
export const TIMER_TICK_MS = 20;

/** Frame lengths and per-frame movement, from the project defaults or the original tables. */
export interface Pacing {
  source: 'project' | 'original';
  /** Length of one animation frame in milliseconds, per game speed. */
  frameMs: Readonly<Record<GameSpeed, number>>;
  /** Map pixels moved per frame, per vehicle. */
  pxPerFrame: Readonly<Record<Vehicle, number>>;
}

/** Project values, used without an imported tables.json. */
export const PROJECT_PACING: Pacing = {
  source: 'project',
  frameMs: { 0: 110, 1: 75, 2: 45, 3: 25 },
  pxPerFrame: { walk: 9, motorbike: 14, car: 20 },
};

/**
 * The original's pacing (docs/GAME_RULES.md section 10): speeds 0-2 wait their table's number of
 * timer ticks per frame, speed 3 runs a frame on every tick. A 0 in the table is taken as one tick
 * (animation only; the exported table has none).
 */
export function pacingFromTables(animation: OriginalTables['animation']): Pacing {
  const ticks = (speed: number) => Math.max(1, animation.frameTicks[speed] ?? 1) * TIMER_TICK_MS;
  const { walk, motorbike, car } = animation.stepPixels;
  return {
    source: 'original',
    frameMs: { 0: ticks(0), 1: ticks(1), 2: ticks(2), 3: TIMER_TICK_MS },
    pxPerFrame: { walk, motorbike, car },
  };
}

export const MOVE = {
  /**
   * Map pixels per board unit. Built-in boards sit on a 1-unit grid, so this is a representative
   * spacing between neighbouring tiles. Project value.
   */
  pxPerBoardUnit: 56,
} as const;

/** Frames for one step: the original formula, at least one frame. */
export function stepFrames(distancePx: number, pxPerFrame: number): number {
  return Math.max(1, Math.trunc(distancePx / pxPerFrame));
}

/** Milliseconds for one step on `vehicle` between tiles `boardDistance` board units apart. */
export function stepMs(
  boardDistance: number,
  vehicle: Vehicle,
  speed: GameSpeed,
  pacing: Pacing = PROJECT_PACING,
): number {
  const frames = stepFrames(boardDistance * MOVE.pxPerBoardUnit, pacing.pxPerFrame[vehicle]);
  return frames * pacing.frameMs[speed];
}

/** Factor for durations given at the default game speed. */
export function frameScale(speed: GameSpeed, pacing: Pacing = PROJECT_PACING): number {
  return pacing.frameMs[speed] / pacing.frameMs[DEFAULT_GAME_SPEED];
}

/**
 * Milliseconds at the default game speed; they scale with the frame length. Project values (the
 * original's dice animation length lives in its animation files).
 */
export const DURATIONS = {
  /** Current player's token pulses when the turn starts. */
  turnStart: 350,
  /**
   * A player's token drops onto the board on their first turn. Project value: the original plays a
   * per-character appearance animation whose length lives in its animation file (GAME_RULES.md
   * section 10; ROADMAP: animation frame counts).
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
} as const;

/** Fixed waits taken from the original code; the game speed does not change them. */
export const FIXED_MS = {
  /** Result stays on screen after the dice stop. */
  diceHold: 500,
  /** Whole bankruptcy animation, including its floating text. */
  bankrupt: 2000,
  /** After a sale the original waits this long, hands the property over, and waits again. */
  auctionSale: 1000,
  /**
   * The original's message for a computer borrowing or repaying at a bank, a loan reminder 1 or 2
   * days ahead, and a loan called in (docs/GAME_RULES.md §4).
   */
  message: 1500,
} as const;

/** Waits without an original value to follow, fixed like the messages above. Not the original's. */
export const PROJECT_MS = {
  /**
   * The month-start report. Non-original: the original's report dialog runs its own timer
   * (0x00437e61, docs/BANK_PLAN.md batch 3-9), not traced yet.
   */
  monthReport: 3000,
  /**
   * The reminder 3 days ahead. Non-original: the original opens a reminder screen for humans
   * (0x00436034), not traced yet; shown as a message for now.
   */
  loanReminderScreen: 1500,
} as const;

/**
 * The original auction dialog runs on its own timer, independent of the game speed (GAME_RULES.md
 * section 10). Computers act on the tick their turn comes up, so there is no thinking pause.
 */
export const AUCTION = {
  tickMs: 100,
  /** Every dialog message holds the auction this long. */
  messageMs: 2000,
  /**
   * Ticks one bid, pass or withdrawal is shown. A raise lasts max(frames + 1, this) ticks, where
   * frames is the bidder's raise animation; without imported animation files the floor applies
   * (ROADMAP: animation frame counts).
   */
  minActionTicks: 10,
} as const;

/** Milliseconds one auction move is shown; `raiseFrames` is known only from imported assets. */
export function auctionActionMs(raiseFrames: number | null): number {
  const ticks = Math.max(raiseFrames === null ? 0 : raiseFrames + 1, AUCTION.minActionTicks);
  return ticks * AUCTION.tickMs;
}

/** Playback speed multiplier while Space is held. Not in the original. */
export const FAST_SPEED = 4;

export function isGameSpeed(value: unknown): value is GameSpeed {
  return GAME_SPEEDS.some((s) => s === value);
}
