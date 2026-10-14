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
    expect(DEFAULT_RULE_CONFIG.winCondition).toBe('lastStanding');
    expect(DEFAULT_RULE_CONFIG.maxRounds).toBeNull();
    expect(DEFAULT_RULE_CONFIG.rentPercentByLevel).toHaveLength(DEFAULT_RULE_CONFIG.maxLevel + 1);
  });
});

describe('validateRuleConfig', () => {
  it('rejects non-integer and negative amounts', () => {
    expect(validateRuleConfig(withConfig({ startingCash: -1 }))).toContainEqual({
      field: 'startingCash',
      reason: 'notNonNegativeInteger',
    });
    expect(validateRuleConfig(withConfig({ startingDeposit: 1.5 }))).toContainEqual({
      field: 'startingDeposit',
      reason: 'notNonNegativeInteger',
    });
  });

  it('requires positive dice and player counts', () => {
    const errors = validateRuleConfig(
      withConfig({ minPlayers: 0, defaultDiceCount: 0, diceFaces: 0 }),
    );
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

  it('requires one rent percent per level', () => {
    expect(validateRuleConfig(withConfig({ rentPercentByLevel: [10, 20] }))).toContainEqual({
      field: 'rentPercentByLevel',
      reason: 'lengthMismatch',
    });
    expect(
      validateRuleConfig(withConfig({ maxLevel: 1, rentPercentByLevel: [10, -1] })),
    ).toContainEqual({ field: 'rentPercentByLevel', reason: 'notNonNegativeInteger' });
  });

  it('ties maxRounds to the richestAtRoundLimit win condition', () => {
    expect(validateRuleConfig(withConfig({ maxRounds: 50 }))).toContainEqual({
      field: 'maxRounds',
      reason: 'mustBeNullForLastStanding',
    });
    expect(
      validateRuleConfig(withConfig({ winCondition: 'richestAtRoundLimit', maxRounds: null })),
    ).toContainEqual({ field: 'maxRounds', reason: 'notPositiveInteger' });
    expect(
      validateRuleConfig(withConfig({ winCondition: 'richestAtRoundLimit', maxRounds: 0 })),
    ).toContainEqual({ field: 'maxRounds', reason: 'notPositiveInteger' });
    expect(
      validateRuleConfig(withConfig({ winCondition: 'richestAtRoundLimit', maxRounds: 50 })),
    ).toEqual([]);
  });
});
