import { describe, expect, it } from 'vitest';
import type { Board } from './board';
import { DEFAULT_RULE_CONFIG, type RuleConfig } from './config';
import { rentFor } from './money';
import type { GameState } from './state';
import {
  applyOk,
  getPlayer,
  loopBoard,
  newTestGame,
  patchPlayer,
  patchTile,
  withFixedDice,
} from './testing';

const PRICE = 1001;
/** Tile 1 belongs to p2 in these tests; tile 2 to p3 when there are three players. */
const BOARD = loopBoard([null, PRICE, 2000, null, null, null]);
/** Tile 1 with its own made-up rents, unrelated to its price. */
const OWN_RENTS = [7, 8, 9, 10, 11, 12];
/** Tiles 1 and 4 are street A, tile 2 is street B; made-up rents. */
const street = (name: string, rents: number[]) => ({ name, price: 500, upgradeCost: 100, rents });
const STREET_BOARD = loopBoard([
  null,
  street('A', [100, 110, 120, 130, 140, 150]),
  street('B', [1000, 1100, 1200, 1300, 1400, 1500]),
  null,
  street('A', [300, 310, 320, 330, 340, 350]),
  null,
]);
const OWN_RENTS_BOARD = loopBoard([
  null,
  { price: PRICE, upgradeCost: 33, rents: OWN_RENTS },
  2000,
  null,
  null,
  null,
]);

/** p1 about to roll a 1 onto p2's tile 1. */
function beforeLanding(
  { cash, deposit = 0, level = 0 }: { cash: number; deposit?: number; level?: number },
  options: { config?: Partial<RuleConfig>; board?: Board; playerCount?: number } = {},
): GameState {
  let state = newTestGame({ board: BOARD, ...options });
  state = patchTile(state, 1, { owner: 'p2', level });
  state = patchPlayer(state, 'p2', { cash: 0, deposit: 0 });
  return withFixedDice(patchPlayer(state, 'p1', { cash, deposit }), [1]);
}

const roll = { type: 'rollDice', playerId: 'p1' } as const;

describe('rentFor', () => {
  it("looks up the tile's own rent at its level, at every level", () => {
    const state = patchTile(newTestGame({ board: OWN_RENTS_BOARD }), 1, { owner: 'p2' });
    for (let level = 0; level <= DEFAULT_RULE_CONFIG.maxLevel; level++) {
      expect(rentFor(patchTile(state, 1, { level }), 1)).toBe(OWN_RENTS[level]);
    }
  });

  it('adds up every tile of the same street the owner has, adjacent or not', () => {
    let state = newTestGame({ board: STREET_BOARD, playerCount: 3 });
    state = patchTile(state, 1, { owner: 'p2', level: 0 });
    state = patchTile(state, 4, { owner: 'p2', level: 0 });
    // 1 and 4 are both on street A, with tile 2 (street B) between them.
    expect(rentFor(state, 1)).toBe(100 + 300);
    expect(rentFor(state, 4)).toBe(100 + 300);
  });

  it("uses each tile's own level", () => {
    let state = newTestGame({ board: STREET_BOARD, playerCount: 3 });
    state = patchTile(state, 1, { owner: 'p2', level: 2 });
    state = patchTile(state, 4, { owner: 'p2', level: 5 });
    expect(rentFor(state, 1)).toBe(120 + 350);
  });

  it("does not count the same street's tiles owned by someone else or no one", () => {
    let state = newTestGame({ board: STREET_BOARD, playerCount: 3 });
    state = patchTile(state, 1, { owner: 'p2', level: 1 });
    state = patchTile(state, 4, { owner: 'p3', level: 1 });
    expect(rentFor(state, 1)).toBe(110);
    expect(rentFor(state, 4)).toBe(310);
    state = patchTile(state, 4, { owner: null, level: 0 });
    expect(rentFor(state, 1)).toBe(110);
  });

  it('does not count other streets', () => {
    let state = newTestGame({ board: STREET_BOARD, playerCount: 3 });
    state = patchTile(state, 1, { owner: 'p2', level: 0 });
    state = patchTile(state, 2, { owner: 'p2', level: 0 });
    expect(rentFor(state, 1)).toBe(100);
    expect(rentFor(state, 2)).toBe(1000);
  });

  it('throws for a tile that is not a property (caller bug)', () => {
    expect(() => rentFor(newTestGame({ board: BOARD }), 0)).toThrow();
  });
});

describe("landing on another player's property", () => {
  it('pays the rent to the owner and ends the turn', () => {
    const { state, events } = applyOk(beforeLanding({ cash: 5000, level: 2 }), roll);
    expect(events.slice(2)).toEqual([
      { type: 'RentPaid', from: 'p1', to: 'p2', tile: 1, amount: 600, into: 'deposit' },
      { type: 'TurnStarted', playerId: 'p2', round: 1 },
    ]);
    expect(getPlayer(state, 'p1').cash).toBe(4400);
    expect(getPlayer(state, 'p2')).toMatchObject({ cash: 0, deposit: 600 });
    expect(state.turn).toMatchObject({ current: 'p2', phase: { kind: 'awaitRoll' } });
    expect(state.tiles[1]).toEqual({ owner: 'p2', level: 2 });
  });

  it('charges the whole street the owner has', () => {
    let start = beforeLanding({ cash: 5000 }, { board: STREET_BOARD });
    start = patchTile(start, 4, { owner: 'p2', level: 3 });
    const { state, events } = applyOk(start, roll);
    expect(events[2]).toEqual({
      type: 'RentPaid',
      from: 'p1',
      to: 'p2',
      tile: 1,
      amount: 430,
      into: 'deposit',
    });
    expect(getPlayer(state, 'p1').cash).toBe(5000 - 430);
  });

  it("charges the tile's own rent for its level", () => {
    const board = OWN_RENTS_BOARD;
    const { events } = applyOk(beforeLanding({ cash: 50, level: 3 }, { board }), roll);
    expect(events[2]).toEqual({
      type: 'RentPaid',
      from: 'p1',
      to: 'p2',
      tile: 1,
      amount: 10,
      into: 'deposit',
    });
  });

  it('can pay with exactly enough cash', () => {
    const { state, events } = applyOk(beforeLanding({ cash: 100, deposit: 9 }), roll);
    expect(events.map((e) => e.type)).toEqual([
      'DiceRolled',
      'PlayerMoved',
      'RentPaid',
      'TurnStarted',
    ]);
    expect(getPlayer(state, 'p1')).toMatchObject({ cash: 0, deposit: 9, bankrupt: false });
  });

  it('takes the rest from the deposit before reporting the rent', () => {
    const { state, events } = applyOk(beforeLanding({ cash: 40, deposit: 60 }), roll);
    expect(events.slice(2, 4)).toEqual([
      { type: 'DepositWithdrawn', playerId: 'p1', amount: 60 },
      { type: 'RentPaid', from: 'p1', to: 'p2', tile: 1, amount: 100, into: 'deposit' },
    ]);
    expect(getPlayer(state, 'p1')).toMatchObject({ cash: 0, deposit: 0, bankrupt: false });
    expect(getPlayer(state, 'p2')).toMatchObject({ cash: 0, deposit: 100 });
  });

  it('bankrupts a player who cannot pay and moves on to the next one', () => {
    let start = beforeLanding({ cash: 40, deposit: 59 }, { playerCount: 3 });
    start = patchTile(start, 1, { owner: 'p3' });
    start = patchTile(start, 4, { owner: 'p1', level: 1 });
    const { state, events } = applyOk(start, roll);
    expect(events.slice(2)).toEqual([
      {
        type: 'PlayerBankrupt',
        playerId: 'p1',
        creditor: 'p3',
        paidToCreditor: 99,
        releasedTiles: [4],
        cause: { kind: 'rent', tile: 1, amountDue: 100 },
      },
      { type: 'TurnStarted', playerId: 'p2', round: 1 },
    ]);
    expect(getPlayer(state, 'p1')).toMatchObject({ cash: 0, deposit: 0, bankrupt: true });
    expect(state.tiles[4]).toEqual({ owner: null, level: 0 });
  });

  it('records a zero rent without bankrupting anyone', () => {
    const board = loopBoard([
      null,
      { price: PRICE, upgradeCost: 500, rents: [0, 30, 60, 100, 150, 200] },
      null,
      null,
    ]);
    const { state, events } = applyOk(beforeLanding({ cash: 0 }, { board }), roll);
    expect(events[2]).toEqual({
      type: 'RentPaid',
      from: 'p1',
      to: 'p2',
      tile: 1,
      amount: 0,
      into: 'deposit',
    });
    expect(getPlayer(state, 'p1').bankrupt).toBe(false);
  });

  it('lets the next visitor buy a tile released by bankruptcy', () => {
    let start = beforeLanding({ cash: 0 }, { playerCount: 3 });
    start = patchTile(start, 1, { owner: 'p3' });
    start = patchTile(start, 2, { owner: 'p1', level: 4 });
    const afterBankruptcy = applyOk(start, roll).state;
    expect(afterBankruptcy.tiles[2]).toEqual({ owner: null, level: 0 });

    const p2Turn = withFixedDice(patchPlayer(afterBankruptcy, 'p2', { cash: 5000 }), [2]);
    const { state } = applyOk(p2Turn, { type: 'rollDice', playerId: 'p2' });
    expect(state.turn.phase).toEqual({ kind: 'awaitBuyDecision', tile: 2, price: 2000 });
  });

  it('charges nothing for passing over the property', () => {
    const start = withFixedDice(beforeLanding({ cash: 500 }), [2]);
    const { state, events } = applyOk(start, roll);
    expect(events.map((e) => e.type)).not.toContain('RentPaid');
    expect(getPlayer(state, 'p2')).toMatchObject({ cash: 0, deposit: 0 });
  });
});
