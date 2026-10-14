// Tunable rule parameters (docs/GAME_RULES.md, fields marked ⚙️).
// Defaults are provisional values chosen for this project, not values from the original game.

export type WinCondition = 'lastStanding' | 'richestAtRoundLimit';

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
  /** Both conditions also end the game when at most one player is left. */
  winCondition: WinCondition;
  /** Required (positive) for 'richestAtRoundLimit', must be null for 'lastStanding'. */
  maxRounds: number | null;
  defaultDiceCount: number;
  diceFaces: number;
  maxLevel: number;
}

export const DEFAULT_RULE_CONFIG: RuleConfig = {
  minPlayers: 2,
  maxPlayers: 4,
  startingFunds: 40_000,
  startingPoints: 0,
  winCondition: 'lastStanding',
  maxRounds: null,
  defaultDiceCount: 1,
  diceFaces: 6,
  maxLevel: 5,
};

export type RuleConfigErrorReason =
  | 'notNonNegativeInteger'
  | 'notPositiveInteger'
  | 'lessThanMinPlayers'
  | 'mustBeNullForLastStanding';

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

  const nonNegative = ['startingPoints', 'maxLevel'] as const;
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

  if (config.winCondition === 'lastStanding') {
    if (config.maxRounds !== null) {
      errors.push({ field: 'maxRounds', reason: 'mustBeNullForLastStanding' });
    }
  } else if (config.maxRounds === null || !isPositiveInteger(config.maxRounds)) {
    errors.push({ field: 'maxRounds', reason: 'notPositiveInteger' });
  }

  return errors;
}
