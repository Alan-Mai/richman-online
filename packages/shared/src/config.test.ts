import { describe, expect, it } from 'vitest';
import { DEFAULT_RULE_CONFIG, validateRuleConfig, type RuleConfig } from './config';

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
      withConfig({ startingFunds: 0, minPlayers: 0, defaultDiceCount: 0, diceFaces: 0 }),
    );
    expect(errors).toContainEqual({ field: 'startingFunds', reason: 'notPositiveInteger' });
    expect(errors).toContainEqual({ field: 'minPlayers', reason: 'notPositiveInteger' });
    expect(errors).toContainEqual({ field: 'defaultDiceCount', reason: 'notPositiveInteger' });
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

  it('no longer has the round limit win condition', () => {
    expect(Object.keys(DEFAULT_RULE_CONFIG)).not.toContain('winCondition');
    expect(Object.keys(DEFAULT_RULE_CONFIG)).not.toContain('maxRounds');
  });
});
