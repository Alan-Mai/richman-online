import { describe, expect, it } from 'vitest';
import type { Board, PropertyTileDef } from './board';
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

function property(price: number, rentTable?: number[]): PropertyTileDef {
  const tile: PropertyTileDef = {
    kind: 'property',
    name: 'P',
    price,
    next: [0],
    pos: { x: 0, y: 0 },
  };
  return rentTable === undefined ? tile : { ...tile, rentTable };
}

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
  it('is floor(price * rentPercentByLevel[level] / 100) at every level', () => {
    const tile = property(PRICE);
    const expected = [100, 300, 600, 1001, 1501, 2002];
    for (let level = 0; level <= DEFAULT_RULE_CONFIG.maxLevel; level++) {
      expect(rentFor(tile, level, DEFAULT_RULE_CONFIG)).toBe(expected[level]);
    }
  });

  it('uses the tile rentTable instead of the percentages when present', () => {
    const tile = property(PRICE, [1, 2, 3, 4, 5, 6]);
    expect(rentFor(tile, 0, DEFAULT_RULE_CONFIG)).toBe(1);
    expect(rentFor(tile, 5, DEFAULT_RULE_CONFIG)).toBe(6);
  });
});

describe("landing on another player's property", () => {
  it('pays the rent to the owner and ends the turn', () => {
    const { state, events } = applyOk(beforeLanding({ cash: 5000, level: 2 }), roll);
    expect(events.slice(2)).toEqual([
      { type: 'RentPaid', from: 'p1', to: 'p2', tile: 1, amount: 600 },
      { type: 'TurnStarted', playerId: 'p2', round: 1 },
    ]);
    expect(getPlayer(state, 'p1').cash).toBe(4400);
    expect(getPlayer(state, 'p2').cash).toBe(600);
    expect(state.turn).toMatchObject({ current: 'p2', phase: { kind: 'awaitRoll' } });
    expect(state.tiles[1]).toEqual({ owner: 'p2', level: 2 });
  });

  it('charges the rentTable value when the board defines one', () => {
    const tiles = BOARD.tiles.map((t, i) =>
      i === 1 ? { ...property(PRICE, [7, 8, 9, 10, 11, 12]), next: t.next } : t,
    );
    const board = { ...BOARD, tiles };
    const { events } = applyOk(beforeLanding({ cash: 50, level: 3 }, { board }), roll);
    expect(events[2]).toEqual({ type: 'RentPaid', from: 'p1', to: 'p2', tile: 1, amount: 10 });
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
      { type: 'RentPaid', from: 'p1', to: 'p2', tile: 1, amount: 100 },
    ]);
    expect(getPlayer(state, 'p1')).toMatchObject({ cash: 0, deposit: 0, bankrupt: false });
    expect(getPlayer(state, 'p2').cash).toBe(100);
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
    const config = { rentPercentByLevel: [0, 30, 60, 100, 150, 200] };
    const { state, events } = applyOk(beforeLanding({ cash: 0 }, { config }), roll);
    expect(events[2]).toEqual({ type: 'RentPaid', from: 'p1', to: 'p2', tile: 1, amount: 0 });
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
    expect(getPlayer(state, 'p2').cash).toBe(0);
  });
});
