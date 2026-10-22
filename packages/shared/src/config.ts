// Tunable rule parameters (docs/GAME_RULES.md, fields marked ⚙️).
// Defaults are provisional values chosen for this project, not values from the original game, unless
// a field says it is the original's.

import {
  EARLIEST_START_DATE,
  LATEST_START_DATE,
  compareDates,
  isValidDate,
  type CalendarDate,
} from './calendar';

/** How a player gets around (docs/GAME_RULES.md §9). The temporary vehicle is Phase 5. */
export type Vehicle = 'walk' | 'motorbike' | 'car';

export const VEHICLES: readonly Vehicle[] = ['walk', 'motorbike', 'car'];

export interface RuleConfig {
  minPlayers: number;
  maxPlayers: number;
  /**
   * The one starting amount of the original setup screen (docs/GAME_RULES.md §1). Each human gets
   * floor(startingFunds / 2) as cash and as deposit, each computer splits it by its profile
   * (openingSplit); it is also the price index divisor.
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
  /**
   * The calendar date of a new game (docs/GAME_RULES.md §2 "日曆"), within EARLIEST_START_DATE ..
   * LATEST_START_DATE, the range the original clamps the computer's date to. The default,
   * 1 January 2010, is where the original starts on any computer today.
   */
  startDate: CalendarDate;
  /**
   * What every player rides from the start; one setting for all, as on the original setup screen
   * (docs/GAME_RULES.md §9).
   */
  startingVehicle: Vehicle;
  /** Most dice a player may roll on each vehicle (docs/GAME_RULES.md §9; the original's). */
  vehicleMaxDice: Readonly<Record<Vehicle, number>>;
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
  /** How computer players bid (docs/GAME_RULES.md §8; the original's constants). */
  computerBid: ComputerBidConfig;
  /** How computer players on a motorbike or car choose their dice count (docs/GAME_RULES.md §9). */
  computerDice: ComputerDiceConfig;
}

/**
 * A computer on a motorbike or car looks at the property tiles its next previewSteps steps would
 * land on: unowned or its own are good, anyone else's are bad. No good tile and at least
 * crowdedBadTiles bad ones: a random count from crowdedMinDice to the vehicle's most. At least
 * clearGoodTiles good and at most clearBadTiles bad: 1 die. Otherwise the vehicle's most.
 */
export interface ComputerDiceConfig {
  previewSteps: number;
  crowdedBadTiles: number;
  crowdedMinDice: number;
  clearGoodTiles: number;
  clearBadTiles: number;
}

/**
 * A computer bidder's limit is the least of its cash and two amounts, each with a random factor
 * drawn when the auction opens:
 * - (level ÷ 2 rounded down + 1 + own properties on the street) × start price × price index ×
 *   (unownedBase − unownedSlope × share of unowned properties) × streetFactor
 * - land price × price index × landFactor
 */
export interface ComputerBidConfig {
  /** Closed range of the first random factor. */
  streetFactor: readonly [number, number];
  /** Half-open range of the second random factor. */
  landFactor: readonly [number, number];
  unownedBase: number;
  unownedSlope: number;
  /**
   * When the leader's cash plus this falls short of the chosen raise, a smaller raise is used
   * (docs/GAME_RULES.md §8).
   */
  leaderCashMargin: number;
}

export const DEFAULT_RULE_CONFIG: RuleConfig = {
  minPlayers: 2,
  maxPlayers: 4,
  startingFunds: 40_000,
  startingPoints: 0,
  dayLimit: null,
  netWorthTargetMultiple: null,
  startDate: { year: 2010, month: 1, day: 1 },
  startingVehicle: 'walk',
  vehicleMaxDice: { walk: 1, motorbike: 2, car: 3 },
  diceFaces: 6,
  maxLevel: 5,
  auctionPlotCount: 3,
  auctionRaises: [100, 500, 1000, 5000, 10000],
  computerBid: {
    streetFactor: [0.5, 0.8],
    landFactor: [3, 3.5],
    unownedBase: 6,
    unownedSlope: 4,
    leaderCashMargin: 500,
  },
  computerDice: {
    previewSteps: 5,
    crowdedBadTiles: 3,
    crowdedMinDice: 2,
    clearGoodTiles: 2,
    clearBadTiles: 1,
  },
};

export type RuleConfigErrorReason =
  | 'notNonNegativeInteger'
  | 'notPositiveInteger'
  | 'lessThanMinPlayers'
  | 'notAscendingPositiveIntegers'
  | 'invalidComputerBid'
  | 'invalidComputerDice'
  | 'invalidVehicle'
  | 'invalidStartDate';

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

  const positive = ['startingFunds', 'minPlayers', 'maxPlayers', 'diceFaces'] as const;
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

  const { streetFactor, landFactor, unownedBase, unownedSlope, leaderCashMargin } =
    config.computerBid;
  const amounts = [...streetFactor, ...landFactor, unownedBase, unownedSlope, leaderCashMargin];
  const ranges = [streetFactor, landFactor].every(([low, high]) => low <= high);
  if (!amounts.every((n) => Number.isFinite(n) && n >= 0) || !ranges) {
    errors.push({ field: 'computerBid', reason: 'invalidComputerBid' });
  }

  const dice = config.computerDice;
  const counts = [dice.previewSteps, dice.crowdedBadTiles, dice.clearGoodTiles, dice.clearBadTiles];
  // The crowded draw runs from crowdedMinDice up to the vehicle's most, so it must fit every
  // vehicle that chooses a count (not walking); the engine has no fallback for a larger minimum.
  // A maximum that is not a positive integer is reported under vehicleMaxDice instead.
  const fitsVehicles = (['motorbike', 'car'] as const).every((vehicle) => {
    const most = config.vehicleMaxDice[vehicle];
    return !isPositiveInteger(most) || dice.crowdedMinDice <= most;
  });
  if (
    !counts.every(isNonNegativeInteger) ||
    !isPositiveInteger(dice.crowdedMinDice) ||
    !fitsVehicles
  ) {
    errors.push({ field: 'computerDice', reason: 'invalidComputerDice' });
  }

  if (!VEHICLES.includes(config.startingVehicle)) {
    errors.push({ field: 'startingVehicle', reason: 'invalidVehicle' });
  }
  if (!VEHICLES.every((vehicle) => isPositiveInteger(config.vehicleMaxDice[vehicle]))) {
    errors.push({ field: 'vehicleMaxDice', reason: 'notPositiveInteger' });
  }

  const { startDate } = config;
  if (
    !isValidDate(startDate) ||
    compareDates(startDate, EARLIEST_START_DATE) < 0 ||
    compareDates(startDate, LATEST_START_DATE) > 0
  ) {
    errors.push({ field: 'startDate', reason: 'invalidStartDate' });
  }

  for (const field of ['dayLimit', 'netWorthTargetMultiple'] as const) {
    const value = config[field];
    if (value !== null && !isPositiveInteger(value)) {
      errors.push({ field, reason: 'notPositiveInteger' });
    }
  }

  return errors;
}
