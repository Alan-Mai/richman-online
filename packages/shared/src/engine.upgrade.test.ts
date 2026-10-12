import { describe, expect, it } from 'vitest';
import type { Action } from './actions';
import { DEFAULT_RULE_CONFIG, type RuleConfig } from './config';
import { applyAction, legalActions } from './engine';
import { upgradeCost } from './money';
import type { GameState } from './state';
import {
  applyOk,
  getPlayer,
  loopBoard,
  newTestGame,
  patchPlayer,
  patchTile,
  patchTurn,
  withFixedDice,
} from './testing';

const PRICE = 1001;
const COST = 500; // floor(1001 * 50 / 100)
/** Tile 1 is a property p1 already owns. */
const BOARD = loopBoard([null, PRICE, null, null]);

function beforeLanding(
  { cash, deposit = 0, level = 0 }: { cash: number; deposit?: number; level?: number },
  config: Partial<RuleConfig> = {},
): GameState {
  let state = newTestGame({ board: BOARD, config });
  state = patchTile(state, 1, { owner: 'p1', level });
  return withFixedDice(patchPlayer(state, 'p1', { cash, deposit }), [1]);
}

function landed(
  money: { cash: number; deposit?: number; level?: number },
  config: Partial<RuleConfig> = {},
) {
  return applyOk(beforeLanding(money, config), { type: 'rollDice', playerId: 'p1' });
}

const upgrade: Action = { type: 'upgradeProperty', playerId: 'p1' };
const decline: Action = { type: 'decline', playerId: 'p1' };

describe('upgradeCost', () => {
  it('is floor(price * upgradeCostPercent / 100)', () => {
    expect(upgradeCost(1000, DEFAULT_RULE_CONFIG)).toBe(500);
    expect(upgradeCost(1001, DEFAULT_RULE_CONFIG)).toBe(500);
    expect(upgradeCost(999, { ...DEFAULT_RULE_CONFIG, upgradeCostPercent: 33 })).toBe(329);
    expect(upgradeCost(999, { ...DEFAULT_RULE_CONFIG, upgradeCostPercent: 0 })).toBe(0);
  });
});

describe('landing on an own property', () => {
  it('offers a one-level upgrade at upgradeCost', () => {
    const { state, events } = landed({ cash: COST + 1 });
    expect(state.turn.phase).toEqual({ kind: 'awaitUpgradeDecision', tile: 1, cost: COST });
    expect(events.map((e) => e.type)).toEqual(['DiceRolled', 'PlayerMoved']);
  });

  it('offers the upgrade when cash is exactly the cost', () => {
    expect(landed({ cash: COST }).state.turn.phase.kind).toBe('awaitUpgradeDecision');
  });

  it('skips the offer when cash is one short', () => {
    expect(landed({ cash: COST - 1 }).state.turn).toMatchObject({
      current: 'p2',
      phase: { kind: 'awaitRoll' },
    });
  });

  it('counts the deposit with cashAndDeposit', () => {
    const funds = { purchaseFunds: 'cashAndDeposit' } as const;
    expect(landed({ cash: 100, deposit: COST - 100 }, funds).state.turn.phase.kind).toBe(
      'awaitUpgradeDecision',
    );
    expect(landed({ cash: 100, deposit: COST - 101 }, funds).state.turn.current).toBe('p2');
  });

  it('offers the last level and nothing beyond maxLevel', () => {
    const { maxLevel } = DEFAULT_RULE_CONFIG;
    expect(landed({ cash: 1e6, level: maxLevel - 1 }).state.turn.phase.kind).toBe(
      'awaitUpgradeDecision',
    );
    expect(landed({ cash: 1e6, level: maxLevel }).state.turn.current).toBe('p2');
  });

  it('offers nothing when upgradeOnOwnTile is off', () => {
    expect(landed({ cash: 1e6 }, { upgradeOnOwnTile: false }).state.turn.current).toBe('p2');
  });

  it('always offers a free upgrade when upgradeCostPercent is 0', () => {
    const { state } = landed({ cash: 0 }, { upgradeCostPercent: 0 });
    expect(state.turn.phase).toEqual({ kind: 'awaitUpgradeDecision', tile: 1, cost: 0 });
    const after = applyOk(state, upgrade).state;
    expect(after.tiles[1]?.level).toBe(1);
    expect(getPlayer(after, 'p1')).toMatchObject({ cash: 0, deposit: 0 });
  });
});

describe('upgradeProperty', () => {
  it('raises the level by one, pays and ends the turn', () => {
    const offered = landed({ cash: COST + 30, deposit: 9, level: 2 }).state;
    const { state, events } = applyOk(offered, upgrade);
    expect(state.tiles[1]).toEqual({ owner: 'p1', level: 3 });
    expect(getPlayer(state, 'p1')).toMatchObject({ cash: 30, deposit: 9 });
    expect(events).toEqual([
      { type: 'PropertyUpgraded', playerId: 'p1', tile: 1, level: 3, cost: COST },
      { type: 'TurnStarted', playerId: 'p2', round: 1 },
    ]);
  });

  it('can spend all cash when it is exactly the cost', () => {
    const { state } = applyOk(landed({ cash: COST }).state, upgrade);
    expect(getPlayer(state, 'p1').cash).toBe(0);
    expect(state.tiles[1]?.level).toBe(1);
  });

  it('takes the shortfall from the deposit with cashAndDeposit', () => {
    const funds = { purchaseFunds: 'cashAndDeposit' } as const;
    const offered = landed({ cash: 100, deposit: COST - 100 }, funds).state;
    const { state, events } = applyOk(offered, upgrade);
    expect(getPlayer(state, 'p1')).toMatchObject({ cash: 0, deposit: 0 });
    expect(events[0]).toEqual({ type: 'DepositWithdrawn', playerId: 'p1', amount: COST - 100 });
    expect(events[1]).toMatchObject({ type: 'PropertyUpgraded', level: 1 });
  });

  it('can reach maxLevel', () => {
    const { maxLevel } = DEFAULT_RULE_CONFIG;
    const { state } = applyOk(landed({ cash: 1e6, level: maxLevel - 1 }).state, upgrade);
    expect(state.tiles[1]?.level).toBe(maxLevel);
  });

  it('rejects the upgrade if the money is no longer there', () => {
    const offered = patchPlayer(landed({ cash: COST }).state, 'p1', { cash: COST - 1 });
    expect(applyAction(offered, upgrade)).toEqual({
      ok: false,
      error: { code: 'insufficientFunds' },
    });
  });
});

describe('decline an upgrade', () => {
  it('keeps the level and the money', () => {
    const offered = landed({ cash: COST, level: 1 }).state;
    const { state, events } = applyOk(offered, decline);
    expect(state.tiles[1]).toEqual({ owner: 'p1', level: 1 });
    expect(getPlayer(state, 'p1').cash).toBe(COST);
    expect(events).toEqual([{ type: 'TurnStarted', playerId: 'p2', round: 1 }]);
  });
});

describe('upgrade decision validation', () => {
  it('rejects upgradeProperty while waiting for a roll or a purchase', () => {
    expect(applyAction(newTestGame({ board: BOARD }), upgrade)).toEqual({
      ok: false,
      error: { code: 'wrongPhase', phase: 'awaitRoll' },
    });
    const buying = patchTurn(newTestGame({ board: BOARD }), {
      phase: { kind: 'awaitBuyDecision', tile: 1, price: PRICE },
    });
    expect(applyAction(buying, upgrade)).toEqual({
      ok: false,
      error: { code: 'wrongPhase', phase: 'awaitBuyDecision' },
    });
  });

  it('rejects another player deciding', () => {
    const offered = landed({ cash: COST }).state;
    expect(applyAction(offered, { type: 'upgradeProperty', playerId: 'p2' })).toEqual({
      ok: false,
      error: { code: 'notYourTurn' },
    });
  });

  it('rejects rolling or buying during the decision', () => {
    const offered = landed({ cash: COST }).state;
    for (const type of ['rollDice', 'buyProperty'] as const) {
      expect(applyAction(offered, { type, playerId: 'p1' })).toEqual({
        ok: false,
        error: { code: 'wrongPhase', phase: 'awaitUpgradeDecision' },
      });
    }
  });

  it('offers upgradeProperty and decline to the current player only', () => {
    const offered = landed({ cash: COST }).state;
    expect(legalActions(offered, 'p1')).toEqual([upgrade, decline]);
    expect(legalActions(offered, 'p2')).toEqual([]);
  });
});
