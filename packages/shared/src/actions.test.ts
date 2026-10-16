import { describe, expect, it } from 'vitest';
import { allows, type Action, type LegalAction } from './actions';

const range: LegalAction = { type: 'bankTransfer', playerId: 'p1', direction: 'deposit', max: 300 };
const transfer = (amount: number, patch: Partial<Action> = {}) =>
  ({ type: 'bankTransfer', playerId: 'p1', direction: 'deposit', amount, ...patch }) as Action;

describe('allows', () => {
  it('matches exact offers field by field', () => {
    expect(
      allows(
        { type: 'bid', playerId: 'p1', raise: 100 },
        { type: 'bid', playerId: 'p1', raise: 100 },
      ),
    ).toBe(true);
    expect(
      allows(
        { type: 'bid', playerId: 'p1', raise: 100 },
        { type: 'bid', playerId: 'p1', raise: 500 },
      ),
    ).toBe(false);
    expect(allows({ type: 'rollDice', playerId: 'p1' }, { type: 'rollDice', playerId: 'p2' })).toBe(
      false,
    );
    expect(
      allows({ type: 'rollDice', playerId: 'p1' }, { type: 'leaveBank', playerId: 'p1' }),
    ).toBe(false);
  });

  it('allows any whole amount 1..max of a range', () => {
    for (const amount of [1, 150, 300]) expect(allows(range, transfer(amount))).toBe(true);
    for (const amount of [0, 301, 1.5, -1]) expect(allows(range, transfer(amount))).toBe(false);
  });

  it('needs the same player and direction for a range', () => {
    expect(allows(range, transfer(1, { playerId: 'p2' }))).toBe(false);
    expect(allows(range, transfer(1, { direction: 'withdraw' }))).toBe(false);
    expect(allows(range, { type: 'leaveBank', playerId: 'p1' })).toBe(false);
  });

  it('does not treat a transfer as an exact offer', () => {
    expect(allows({ type: 'leaveBank', playerId: 'p1' }, transfer(1))).toBe(false);
  });
});
