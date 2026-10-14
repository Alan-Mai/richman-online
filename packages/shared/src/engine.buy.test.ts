import { describe, expect, it } from 'vitest';
import type { Action } from './actions';
import type { RuleConfig } from './config';
import { applyAction, legalActions } from './engine';
import { buyPrice } from './money';
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

const PRICE = 1000;
const UPGRADE_COST = 370;
/** Tile 1 is an unowned property; tile 2 is blank. */
const BOARD = loopBoard([
  null,
  { price: PRICE, upgradeCost: UPGRADE_COST, rents: [1, 2, 3, 4, 5, 6] },
  null,
  null,
  null,
  null,
]);

describe('buyPrice', () => {
  it('is the land price for an unbuilt tile', () => {
    expect(buyPrice(newTestGame({ board: BOARD }), 1)).toBe(PRICE);
  });

  it('adds the upgrade cost of every level already built', () => {
    const state = newTestGame({ board: BOARD });
    expect(buyPrice(patchTile(state, 1, { level: 1 }), 1)).toBe(PRICE + UPGRADE_COST);
    expect(buyPrice(patchTile(state, 1, { level: 3 }), 1)).toBe(PRICE + 3 * UPGRADE_COST);
  });
});

/** p1 about to roll a 1 onto tile 1 with the given money. */
function beforeLanding(
  money: { cash: number; deposit?: number },
  config: Partial<RuleConfig> = {},
): GameState {
  const state = newTestGame({ board: BOARD, config });
  return withFixedDice(patchPlayer(state, 'p1', { deposit: 0, ...money }), [1]);
}

function landed(money: { cash: number; deposit?: number }, config: Partial<RuleConfig> = {}) {
  return applyOk(beforeLanding(money, config), { type: 'rollDice', playerId: 'p1' });
}

const buy: Action = { type: 'buyProperty', playerId: 'p1' };
const decline: Action = { type: 'decline', playerId: 'p1' };

describe('landing on an unowned property', () => {
  it('offers the purchase at the board price', () => {
    const { state, events } = landed({ cash: PRICE + 1 });
    expect(state.turn).toEqual({
      current: 'p1',
      round: 1,
      phase: { kind: 'awaitBuyDecision', tile: 1, price: PRICE },
    });
    expect(events.map((e) => e.type)).toEqual(['DiceRolled', 'PlayerMoved']);
  });

  it('asks for the buildings too on an unowned tile that has some', () => {
    const start = patchTile(beforeLanding({ cash: 1e6 }), 1, { level: 2 });
    const { state } = applyOk(start, { type: 'rollDice', playerId: 'p1' });
    const price = PRICE + 2 * UPGRADE_COST;
    expect(state.turn.phase).toEqual({ kind: 'awaitBuyDecision', tile: 1, price });
    const bought = applyOk(state, buy).state;
    expect(getPlayer(bought, 'p1').cash).toBe(1e6 - price);
    expect(bought.tiles[1]).toEqual({ owner: 'p1', level: 2 });
  });

  it('offers the purchase when cash is exactly the price', () => {
    expect(landed({ cash: PRICE }).state.turn.phase.kind).toBe('awaitBuyDecision');
  });

  it('skips the offer when cash is one short', () => {
    const { state, events } = landed({ cash: PRICE - 1 });
    expect(state.turn).toMatchObject({ current: 'p2', phase: { kind: 'awaitRoll' } });
    expect(events.at(-1)).toEqual({ type: 'TurnStarted', playerId: 'p2', round: 1 });
  });

  it('does not count the deposit', () => {
    expect(landed({ cash: PRICE - 1, deposit: 1e6 }).state.turn.current).toBe('p2');
  });

  it('does not offer anything on a blank tile', () => {
    const start = withFixedDice(newTestGame({ board: BOARD }), [2]);
    const { state } = applyOk(start, { type: 'rollDice', playerId: 'p1' });
    expect(state.turn).toMatchObject({ current: 'p2', phase: { kind: 'awaitRoll' } });
  });
});

describe('buyProperty', () => {
  it('pays from cash, takes ownership and ends the turn', () => {
    const offered = landed({ cash: PRICE + 250, deposit: 70 }).state;
    const { state, events } = applyOk(offered, buy);
    expect(getPlayer(state, 'p1')).toMatchObject({ cash: 250, deposit: 70 });
    expect(state.tiles[1]).toEqual({ owner: 'p1', level: 0 });
    expect(events).toEqual([
      { type: 'PropertyBought', playerId: 'p1', tile: 1, price: PRICE },
      { type: 'TurnStarted', playerId: 'p2', round: 1 },
    ]);
    expect(state.turn).toMatchObject({ current: 'p2', phase: { kind: 'awaitRoll' } });
  });

  it('can spend all cash when it is exactly the price', () => {
    const { state } = applyOk(landed({ cash: PRICE }).state, buy);
    expect(getPlayer(state, 'p1').cash).toBe(0);
    expect(state.tiles[1]?.owner).toBe('p1');
  });

  it('rejects the purchase if the cash is no longer there, whatever the deposit', () => {
    const offered = patchPlayer(landed({ cash: PRICE }).state, 'p1', {
      cash: PRICE - 1,
      deposit: 1e6,
    });
    const snapshot = JSON.stringify(offered);
    expect(applyAction(offered, buy)).toEqual({ ok: false, error: { code: 'insufficientFunds' } });
    expect(JSON.stringify(offered)).toBe(snapshot);
  });
});

describe('decline a purchase', () => {
  it('leaves the tile unowned and the money untouched', () => {
    const offered = landed({ cash: PRICE + 5 }).state;
    const { state, events } = applyOk(offered, decline);
    expect(state.tiles[1]).toEqual({ owner: null, level: 0 });
    expect(getPlayer(state, 'p1').cash).toBe(PRICE + 5);
    expect(events).toEqual([{ type: 'TurnStarted', playerId: 'p2', round: 1 }]);
  });
});

describe('buy decision validation', () => {
  it('rejects buyProperty and decline while waiting for a roll', () => {
    const state = newTestGame({ board: BOARD });
    for (const action of [buy, decline]) {
      expect(applyAction(state, action)).toEqual({
        ok: false,
        error: { code: 'wrongPhase', phase: 'awaitRoll' },
      });
    }
  });

  it('rejects another player deciding', () => {
    const offered = landed({ cash: PRICE }).state;
    expect(applyAction(offered, { type: 'buyProperty', playerId: 'p2' })).toEqual({
      ok: false,
      error: { code: 'notYourTurn' },
    });
  });

  it('rejects rolling or upgrading during the decision', () => {
    const offered = landed({ cash: PRICE }).state;
    for (const type of ['rollDice', 'upgradeProperty'] as const) {
      expect(applyAction(offered, { type, playerId: 'p1' })).toEqual({
        ok: false,
        error: { code: 'wrongPhase', phase: 'awaitBuyDecision' },
      });
    }
  });

  it('offers buyProperty and decline to the current player only', () => {
    const offered = landed({ cash: PRICE }).state;
    expect(legalActions(offered, 'p1')).toEqual([buy, decline]);
    expect(legalActions(offered, 'p2')).toEqual([]);
  });

  it('rejects buying while an upgrade is pending', () => {
    const pending = patchTurn(newTestGame({ board: BOARD }), {
      phase: { kind: 'awaitUpgradeDecision', tile: 1, cost: 1 },
    });
    expect(applyAction(pending, buy)).toEqual({
      ok: false,
      error: { code: 'wrongPhase', phase: 'awaitUpgradeDecision' },
    });
  });
});
