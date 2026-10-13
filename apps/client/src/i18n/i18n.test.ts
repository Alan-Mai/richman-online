import { describe, expect, it } from 'vitest';
import { formatMoney, t, type MessageKey } from './index';
import { zhTW } from './zh-TW';

describe('t', () => {
  it('returns messages without placeholders as written', () => {
    expect(t('action.rollDice')).toBe('擲骰子');
  });

  it('fills in every placeholder', () => {
    expect(t('event.diceRolled', { name: '甲', dice: '3、4', total: 7 })).toBe(
      '甲 擲出 3、4，共 7 點',
    );
  });

  it('requires params exactly when the message has placeholders (type-level)', () => {
    // @ts-expect-error params are required for messages with placeholders
    expect(() => t('event.bankrupt')).not.toThrow();
    // @ts-expect-error every placeholder needs a value
    expect(t('event.moved', { name: '甲' })).toBe('甲 走到 {tile}');
  });

  it('leaves a placeholder visible when its value is missing', () => {
    const loose = t as (key: MessageKey, params?: Record<string, string | number>) => string;
    expect(loose('event.bankrupt', {})).toBe('{name} 破產了');
  });

  it('has no empty messages', () => {
    for (const [key, text] of Object.entries(zhTW)) {
      expect(text.trim(), key).not.toBe('');
    }
  });
});

describe('formatMoney', () => {
  it('groups thousands', () => {
    expect(formatMoney(1234567)).toBe('1,234,567');
    expect(formatMoney(0)).toBe('0');
    expect(formatMoney(-2500)).toBe('-2,500');
  });
});
