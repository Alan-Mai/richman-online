import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RULE_CONFIG,
  VEHICLES,
  validateRuleConfig,
  type RuleConfig,
  type Vehicle,
} from './config';

function withConfig(patch: Partial<RuleConfig>): RuleConfig {
  return { ...DEFAULT_RULE_CONFIG, ...patch };
}

describe('DEFAULT_RULE_CONFIG', () => {
  it('is valid', () => {
    expect(validateRuleConfig(DEFAULT_RULE_CONFIG)).toEqual([]);
  });

  it('uses the agreed defaults', () => {
    // The original's first option for both: no limit, no target.
    expect(DEFAULT_RULE_CONFIG.dayLimit).toBeNull();
    expect(DEFAULT_RULE_CONFIG.netWorthTargetMultiple).toBeNull();
    // Where the original starts on any computer today (docs/GAME_RULES.md §2).
    expect(DEFAULT_RULE_CONFIG.startDate).toEqual({ year: 2010, month: 1, day: 1 });
  });
});

describe('startDate', () => {
  const at = (year: number, month: number, day: number) =>
    validateRuleConfig(withConfig({ startDate: { year, month, day } }));
  const invalid = { field: 'startDate', reason: 'invalidStartDate' };

  it('accepts the original clamp range, both ends included', () => {
    expect(at(1998, 1, 1)).toEqual([]);
    expect(at(2004, 2, 29)).toEqual([]);
    expect(at(2010, 12, 31)).toEqual([]);
  });

  it('rejects dates outside the range', () => {
    expect(at(1997, 12, 31)).toContainEqual(invalid);
    expect(at(2011, 1, 1)).toContainEqual(invalid);
  });

  it('rejects days that do not exist', () => {
    expect(at(2010, 2, 29)).toContainEqual(invalid);
    expect(at(2010, 6, 31)).toContainEqual(invalid);
    expect(at(2010, 13, 1)).toContainEqual(invalid);
    expect(at(2010, 1, 1.5)).toContainEqual(invalid);
  });
});

describe('validateRuleConfig', () => {
  it('rejects non-integer and negative amounts', () => {
    expect(validateRuleConfig(withConfig({ startingPoints: -1 }))).toContainEqual({
      field: 'startingPoints',
      reason: 'notNonNegativeInteger',
    });
    expect(validateRuleConfig(withConfig({ maxLevel: 1.5 }))).toContainEqual({
      field: 'maxLevel',
      reason: 'notNonNegativeInteger',
    });
  });

  it('requires positive starting funds, dice and player counts', () => {
    const errors = validateRuleConfig(
      withConfig({ startingFunds: 0, minPlayers: 0, diceFaces: 0 }),
    );
    expect(errors).toContainEqual({ field: 'startingFunds', reason: 'notPositiveInteger' });
    expect(errors).toContainEqual({ field: 'minPlayers', reason: 'notPositiveInteger' });
    expect(errors).toContainEqual({ field: 'diceFaces', reason: 'notPositiveInteger' });
  });

  it('rejects minPlayers greater than maxPlayers', () => {
    expect(validateRuleConfig(withConfig({ minPlayers: 5, maxPlayers: 4 }))).toContainEqual({
      field: 'maxPlayers',
      reason: 'lessThanMinPlayers',
    });
  });

  it('uses the original auction constants', () => {
    expect(DEFAULT_RULE_CONFIG.auctionPlotCount).toBe(3);
    expect(DEFAULT_RULE_CONFIG.auctionRaises).toEqual([100, 500, 1000, 5000, 10000]);
  });

  it('takes a non-negative auction plot count', () => {
    expect(validateRuleConfig(withConfig({ auctionPlotCount: 0 }))).toEqual([]);
    expect(validateRuleConfig(withConfig({ auctionPlotCount: -1 }))).toContainEqual({
      field: 'auctionPlotCount',
      reason: 'notNonNegativeInteger',
    });
  });

  it('requires the auction raises to be ascending positive integers', () => {
    expect(validateRuleConfig(withConfig({ auctionRaises: [1] }))).toEqual([]);
    for (const auctionRaises of [[], [0, 100], [100, 100], [500, 100], [100, 1.5]]) {
      expect(validateRuleConfig(withConfig({ auctionRaises }))).toEqual([
        { field: 'auctionRaises', reason: 'notAscendingPositiveIntegers' },
      ]);
    }
  });

  it('requires sensible computer bidding constants', () => {
    const bid = DEFAULT_RULE_CONFIG.computerBid;
    expect(bid).toEqual({
      streetFactor: [0.5, 0.8],
      landFactor: [3, 3.5],
      unownedBase: 6,
      unownedSlope: 4,
      leaderCashMargin: 500,
    });
    const bad = [
      { ...bid, streetFactor: [0.8, 0.5] as const },
      { ...bid, landFactor: [-1, 3] as const },
      { ...bid, landFactor: [3, Infinity] as const },
      { ...bid, unownedBase: NaN },
      { ...bid, unownedSlope: -4 },
      { ...bid, leaderCashMargin: -1 },
    ];
    for (const computerBid of bad) {
      expect(validateRuleConfig(withConfig({ computerBid }))).toEqual([
        { field: 'computerBid', reason: 'invalidComputerBid' },
      ]);
    }
  });

  it('takes null or a positive integer as the day limit and the net worth target', () => {
    const valid = withConfig({ dayLimit: 50, netWorthTargetMultiple: 3 });
    expect(validateRuleConfig(valid)).toEqual([]);
    for (const bad of [0, -1, 1.5]) {
      const errors = validateRuleConfig(withConfig({ dayLimit: bad, netWorthTargetMultiple: bad }));
      expect(errors).toContainEqual({ field: 'dayLimit', reason: 'notPositiveInteger' });
      expect(errors).toContainEqual({
        field: 'netWorthTargetMultiple',
        reason: 'notPositiveInteger',
      });
    }
  });

  it('starts everyone on foot, with the original dice limits per vehicle', () => {
    expect(DEFAULT_RULE_CONFIG.startingVehicle).toBe('walk');
    expect(DEFAULT_RULE_CONFIG.vehicleMaxDice).toEqual({ walk: 1, motorbike: 2, car: 3 });
  });

  it('takes any vehicle as the starting vehicle', () => {
    for (const startingVehicle of VEHICLES) {
      expect(validateRuleConfig(withConfig({ startingVehicle }))).toEqual([]);
    }
    const bike = 'bicycle' as unknown as Vehicle;
    expect(validateRuleConfig(withConfig({ startingVehicle: bike }))).toEqual([
      { field: 'startingVehicle', reason: 'invalidVehicle' },
    ]);
  });

  it('requires a positive integer dice limit for every vehicle', () => {
    const limits = DEFAULT_RULE_CONFIG.vehicleMaxDice;
    for (const vehicleMaxDice of [
      { ...limits, walk: 0 },
      { ...limits, motorbike: 1.5 },
      { ...limits, car: -3 },
      { walk: 1, motorbike: 2 } as unknown as Record<Vehicle, number>,
    ]) {
      expect(validateRuleConfig(withConfig({ vehicleMaxDice }))).toEqual([
        { field: 'vehicleMaxDice', reason: 'notPositiveInteger' },
      ]);
    }
  });

  it("uses the original's constants for the computer dice count", () => {
    expect(DEFAULT_RULE_CONFIG.computerDice).toEqual({
      previewSteps: 5,
      crowdedBadTiles: 3,
      crowdedMinDice: 2,
      clearGoodTiles: 2,
      clearBadTiles: 1,
    });
  });

  it('requires whole numbers for the computer dice count, and at least 1 die', () => {
    const dice = DEFAULT_RULE_CONFIG.computerDice;
    expect(validateRuleConfig(withConfig({ computerDice: { ...dice, clearBadTiles: 0 } }))).toEqual(
      [],
    );
    for (const computerDice of [
      { ...dice, previewSteps: -1 },
      { ...dice, crowdedBadTiles: 1.5 },
      { ...dice, crowdedMinDice: 0 },
      { ...dice, clearGoodTiles: NaN },
      { ...dice, clearBadTiles: -1 },
    ]) {
      expect(validateRuleConfig(withConfig({ computerDice }))).toEqual([
        { field: 'computerDice', reason: 'invalidComputerDice' },
      ]);
    }
  });

  it('no longer has a default dice count', () => {
    expect(Object.keys(DEFAULT_RULE_CONFIG)).not.toContain('defaultDiceCount');
  });

  it('no longer has the round limit win condition', () => {
    expect(Object.keys(DEFAULT_RULE_CONFIG)).not.toContain('winCondition');
    expect(Object.keys(DEFAULT_RULE_CONFIG)).not.toContain('maxRounds');
  });
});
