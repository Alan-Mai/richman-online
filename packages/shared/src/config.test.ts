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
