// Animation pacing, in one place so it can be tuned against recordings of the original game.
// Current values are placeholders chosen for this project, not measured from the original.

/** Milliseconds at normal speed. */
export const DURATIONS = {
  /** Current player's token pulses when the turn starts. */
  turnStart: 350,
  /** Dice tumble before the result shows. */
  diceRoll: 700,
  /** Result stays on screen before the dice disappear. */
  diceHold: 450,
  /** One tile of movement (a hop). */
  step: 200,
  /** Floating money / status text rises and fades. */
  float: 750,
  /** Minimum pause after buying or upgrading (runs alongside the floating text). */
  property: 450,
  /** Whole bankruptcy animation, including its floating text. */
  bankrupt: 900,
  /** Pause after the game ends, before the result dialog. */
  gameEnd: 600,
} as const;

/** Playback speed multiplier while Space is held. */
export const FAST_SPEED = 4;
