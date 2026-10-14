// Tunable rule parameters (docs/GAME_RULES.md, fields marked ⚙️).
// Defaults are provisional values chosen for this project, not values from the original game, unless
// a field says it is the original's.

export interface RuleConfig {
  minPlayers: number;
  maxPlayers: number;
  /**
   * The one starting amount of the original setup screen (docs/GAME_RULES.md §1). Each player gets
   * floor(startingFunds / 2) as cash and as deposit; it is also the price index divisor.
   */
  startingFunds: number;
  /** Unused in Phase 2. */
  startingPoints: number;
  /**
   * Days gone by (GameState.day) that end the game, checked as each day goes by
   * (docs/GAME_RULES.md §1); null means no limit, the original's first option. The game also ends
   * whenever at most one player is left.
   */
  dayLimit: number | null;
  /**
   * Net worth that ends the game, as a multiple of startingFunds, checked as each day goes by;
   * null means no target, the original's first option.
   */
  netWorthTargetMultiple: number | null;
  defaultDiceCount: number;
  diceFaces: number;
  maxLevel: number;
  /**
   * A bankrupt player's properties are auctioned only when there are more than this many, and then
   * this many drawn at random (docs/GAME_RULES.md §8; the original's constant).
   */
  auctionPlotCount: number;
  /**
   * The raises a bidder may add to the current price, ascending; not multiplied by the price index
   * (docs/GAME_RULES.md §8; the original's five steps).
   */
  auctionRaises: readonly number[];
}

export const DEFAULT_RULE_CONFIG: RuleConfig = {
  minPlayers: 2,
  maxPlayers: 4,
  startingFunds: 40_000,
  startingPoints: 0,
  dayLimit: null,
  netWorthTargetMultiple: null,
  defaultDiceCount: 1,
  diceFaces: 6,
  maxLevel: 5,
  auctionPlotCount: 3,
  auctionRaises: [100, 500, 1000, 5000, 10000],
};

export type RuleConfigErrorReason =
  | 'notNonNegativeInteger'
  | 'notPositiveInteger'
  | 'lessThanMinPlayers'
  | 'notAscendingPositiveIntegers';

export interface RuleConfigError {
  field: keyof RuleConfig;
  reason: RuleConfigErrorReason;
}

function isNonNegativeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function isPositiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

/** Returns every problem found; an empty array means the config is usable. */
export function validateRuleConfig(config: RuleConfig): RuleConfigError[] {
  const errors: RuleConfigError[] = [];

  const nonNegative = ['startingPoints', 'maxLevel', 'auctionPlotCount'] as const;
  for (const field of nonNegative) {
    if (!isNonNegativeInteger(config[field])) {
      errors.push({ field, reason: 'notNonNegativeInteger' });
    }
  }

  const positive = [
    'startingFunds',
    'minPlayers',
    'maxPlayers',
    'defaultDiceCount',
    'diceFaces',
  ] as const;
  for (const field of positive) {
    if (!isPositiveInteger(config[field])) {
      errors.push({ field, reason: 'notPositiveInteger' });
    }
  }

  if (config.minPlayers > config.maxPlayers) {
    errors.push({ field: 'maxPlayers', reason: 'lessThanMinPlayers' });
  }

  const raises = config.auctionRaises;
  const ascending = raises.every(
    (raise, i) => isPositiveInteger(raise) && (i === 0 || raise > (raises[i - 1] ?? 0)),
  );
  if (raises.length === 0 || !ascending) {
    errors.push({ field: 'auctionRaises', reason: 'notAscendingPositiveIntegers' });
  }

  for (const field of ['dayLimit', 'netWorthTargetMultiple'] as const) {
    const value = config[field];
    if (value !== null && !isPositiveInteger(value)) {
      errors.push({ field, reason: 'notPositiveInteger' });
    }
  }

  return errors;
}
