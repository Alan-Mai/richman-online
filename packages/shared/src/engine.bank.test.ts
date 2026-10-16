import { describe, expect, it } from 'vitest';
import type { Action } from './actions';
import { applyAction, computerAction, legalActions } from './engine';
import { checkInvariants } from './invariants';
import type { GameState, Phase } from './state';
import { viewFor } from './view';
import {
  applyOk,
  getPlayer,
  loopBoard,
  newTestGame,
  patchPlayer,
  patchTurn,
  placePlayer,
  tileOf,
  withFixedDice,
} from './testing';

/** 0 blank, 1 bank, 2 property (1000), 3 bank, 4 and 5 blank. */
const BOARD = loopBoard([null, 'bank', 1000, 'bank', null, null]);

function game(options: Parameters<typeof newTestGame>[0] = {}): GameState {
  return newTestGame({ board: BOARD, ...options });
}

const roll = (playerId: string): Action => ({ type: 'rollDice', playerId });
const leave = (playerId: string): Action => ({ type: 'leaveBank', playerId });
const withdraw = (playerId: string, amount: number): Action => ({
  type: 'bankTransfer',
  playerId,
  direction: 'withdraw',
  amount,
});
const deposit = (playerId: string, amount: number): Action => ({
  type: 'bankTransfer',
  playerId,
  direction: 'deposit',
  amount,
});

/** p1 rolls `total` from tile 0 and stops at the first bank on the way. */
function rollTo(total: number, start: GameState = game()) {
  return applyOk(withFixedDice(start, [total]), roll('p1'));
}

/** rollTo, checked to have stopped at a bank, for tests that go on with bank actions. */
function openBank(total: number, start: GameState = game()): GameState {
  const { state } = rollTo(total, start);
  expect(state.turn.phase.kind).toBe('bank');
  return state;
}

/** p1 paused on bank 1 with two steps left (rolled 3). */
const PAUSED: Phase = { kind: 'bank', tile: 1, trigger: { kind: 'pass', stepsLeft: 2 } };

describe('passing a bank', () => {
  it('stops a human there with the rest of the roll to walk', () => {
    const { state, events } = rollTo(3);
    expect(events).toEqual([
      { type: 'DiceRolled', playerId: 'p1', dice: [3], total: 3 },
      { type: 'PlayerMoved', playerId: 'p1', path: [1] },
      { type: 'BankOpened', playerId: 'p1', tile: 1, trigger: 'pass' },
    ]);
    expect(state.turn).toMatchObject({ current: 'p1', phase: PAUSED });
    expect(getPlayer(state, 'p1').location).toEqual({ kind: 'onBoard', tile: 1, prev: 0 });
    expect(checkInvariants(state)).toEqual([]);
  });

  it('offers withdrawing up to the deposit, depositing up to the cash, and leaving', () => {
    const { state } = rollTo(3, patchPlayer(game(), 'p1', { cash: 300, deposit: 7000 }));
    expect(legalActions(state, 'p1')).toEqual([
      { type: 'bankTransfer', playerId: 'p1', direction: 'withdraw', max: 7000 },
      { type: 'bankTransfer', playerId: 'p1', direction: 'deposit', max: 300 },
      { type: 'leaveBank', playerId: 'p1' },
    ]);
    expect(legalActions(state, 'p2')).toEqual([]);
  });

  it('leaves out a direction with nothing to move', () => {
    const noDeposit = rollTo(3, patchPlayer(game(), 'p1', { cash: 300, deposit: 0 })).state;
    expect(legalActions(noDeposit, 'p1').map((a) => a.type)).toEqual(['bankTransfer', 'leaveBank']);
    expect(legalActions(noDeposit, 'p1')[0]).toMatchObject({ direction: 'deposit', max: 300 });

    const broke = rollTo(3, patchPlayer(game(), 'p1', { cash: 0, deposit: 0 })).state;
    expect(legalActions(broke, 'p1')).toEqual([{ type: 'leaveBank', playerId: 'p1' }]);
  });

  it('withdraws, then walks the rest of the roll', () => {
    const paused = openBank(2);
    const { state, events } = applyOk(paused, withdraw('p1', 500));
    expect(events).toEqual([
      { type: 'BankTransferred', playerId: 'p1', direction: 'withdraw', amount: 500 },
      { type: 'PlayerMoved', playerId: 'p1', path: [2] },
    ]);
    expect(getPlayer(state, 'p1')).toMatchObject({ cash: 20_500, deposit: 19_500 });
    expect(state.turn.phase).toEqual({ kind: 'awaitBuyDecision', tile: 2, price: 1000 });
  });

  it('deposits the whole cash', () => {
    const paused = openBank(2, patchPlayer(game(), 'p1', { cash: 800, deposit: 100 }));
    const { state } = applyOk(paused, deposit('p1', 800));
    expect(getPlayer(state, 'p1')).toMatchObject({ cash: 0, deposit: 900 });
    // Buying only looks at cash, so there is no offer now.
    expect(state.turn.current).toBe('p2');
  });

  it('walks on without moving money when the player leaves', () => {
    const paused = openBank(2);
    const { state, events } = applyOk(paused, leave('p1'));
    expect(events).toEqual([{ type: 'PlayerMoved', playerId: 'p1', path: [2] }]);
    expect(getPlayer(state, 'p1')).toMatchObject({ cash: 20_000, deposit: 20_000 });
    expect(state.turn.phase).toEqual({ kind: 'awaitBuyDecision', tile: 2, price: 1000 });
  });

  it('stops again at every bank on the way, with no limit per turn', () => {
    const first = openBank(4);
    expect(first.turn.phase).toEqual({
      kind: 'bank',
      tile: 1,
      trigger: { kind: 'pass', stepsLeft: 3 },
    });
    const second = applyOk(first, leave('p1'));
    expect(second.events).toEqual([
      { type: 'PlayerMoved', playerId: 'p1', path: [2, 3] },
      { type: 'BankOpened', playerId: 'p1', tile: 3, trigger: 'pass' },
    ]);
    expect(second.state.turn.phase).toEqual({
      kind: 'bank',
      tile: 3,
      trigger: { kind: 'pass', stepsLeft: 1 },
    });
    const third = applyOk(second.state, leave('p1'));
    expect(third.events).toEqual([
      { type: 'PlayerMoved', playerId: 'p1', path: [4] },
      { type: 'TurnStarted', playerId: 'p2', round: 1 },
    ]);
    expect(tileOf(third.state, 'p1')).toBe(4);
  });

  it('does not stop a computer, which rebalances on the way without drawing from the RNG', () => {
    // 1 January: the 50% target is raised to 75%, and half cash is 0.25 short of it.
    const start = game({ controllers: ['computer', 'human'] });
    const { state, events } = rollTo(2, start);
    expect(events).toEqual([
      { type: 'DiceRolled', playerId: 'p1', dice: [2], total: 2 },
      { type: 'PlayerMoved', playerId: 'p1', path: [1] },
      { type: 'BankRebalanced', playerId: 'p1', tile: 1, cash: 30_000, deposit: 10_000 },
      { type: 'PlayerMoved', playerId: 'p1', path: [2] },
    ]);
    expect(getPlayer(state, 'p1')).toMatchObject({ cash: 30_000, deposit: 10_000 });
    expect(state.turn.phase).toEqual({ kind: 'awaitBuyDecision', tile: 2, price: 1000 });
    expect(state.rngState).toEqual({ kind: 'scripted', values: [] });
  });

  it('keeps the path whole when a computer has nothing to move', () => {
    // A 33% target is 49.5% on 1 January, close enough to half cash.
    const start = game({
      controllers: ['computer', 'human'],
      profiles: [{ cashPercent: 33, loanPercent: 0 }],
    });
    const { events } = rollTo(2, start);
    expect(events.map((e) => e.type)).toEqual(['DiceRolled', 'PlayerMoved']);
    expect(events[1]).toEqual({ type: 'PlayerMoved', playerId: 'p1', path: [1, 2] });
  });
});

describe('stopping on a bank', () => {
  it('opens the bank, and the turn ends once the player is done', () => {
    // Rolling 1 from tile 0 lands on bank 1.
    const { state, events } = rollTo(1);
    expect(events).toEqual([
      { type: 'DiceRolled', playerId: 'p1', dice: [1], total: 1 },
      { type: 'PlayerMoved', playerId: 'p1', path: [1] },
      { type: 'BankOpened', playerId: 'p1', tile: 1, trigger: 'land' },
    ]);
    expect(state.turn.phase).toEqual({ kind: 'bank', tile: 1, trigger: { kind: 'land' } });
    expect(checkInvariants(state)).toEqual([]);

    const done = applyOk(state, deposit('p1', 100));
    expect(done.events).toEqual([
      { type: 'BankTransferred', playerId: 'p1', direction: 'deposit', amount: 100 },
      { type: 'TurnStarted', playerId: 'p2', round: 1 },
    ]);
    expect(getPlayer(done.state, 'p1')).toMatchObject({ cash: 19_900, deposit: 20_100 });
    expect(applyOk(state, leave('p1')).events).toEqual([
      { type: 'TurnStarted', playerId: 'p2', round: 1 },
    ]);
  });

  it('opens after walking past another bank', () => {
    const paused = openBank(3);
    const { state, events } = applyOk(paused, leave('p1'));
    expect(events).toEqual([
      { type: 'PlayerMoved', playerId: 'p1', path: [2, 3] },
      { type: 'BankOpened', playerId: 'p1', tile: 3, trigger: 'land' },
    ]);
    expect(state.turn.phase).toEqual({ kind: 'bank', tile: 3, trigger: { kind: 'land' } });
  });

  it('rebalances a computer, then ends the turn', () => {
    const { state, events } = rollTo(1, game({ controllers: ['computer', 'human'] }));
    expect(events).toEqual([
      { type: 'DiceRolled', playerId: 'p1', dice: [1], total: 1 },
      { type: 'PlayerMoved', playerId: 'p1', path: [1] },
      { type: 'BankRebalanced', playerId: 'p1', tile: 1, cash: 30_000, deposit: 10_000 },
      { type: 'TurnStarted', playerId: 'p2', round: 1 },
    ]);
    expect(getPlayer(state, 'p1')).toMatchObject({ cash: 30_000, deposit: 10_000 });
  });

  it('uses the day of the month for the target', () => {
    // On 15 January the target is 50%, which half cash already is.
    const start = game({ controllers: ['computer', 'human'] });
    const mid = { ...start, date: { year: 2010, month: 1, day: 15 }, day: 14 };
    const { events } = rollTo(1, mid);
    expect(events.map((e) => e.type)).toEqual(['DiceRolled', 'PlayerMoved', 'TurnStarted']);
  });
});

describe('bank actions', () => {
  const paused = (): GameState => openBank(3);

  it('refuses more than there is to move as insufficientFunds', () => {
    const state = paused();
    for (const action of [withdraw('p1', 20_001), deposit('p1', 20_001)]) {
      expect(applyAction(state, action)).toEqual({
        ok: false,
        error: { code: 'insufficientFunds' },
      });
    }
  });

  it('rejects amounts below 1 and malformed transfers as invalidAction', () => {
    const state = paused();
    const bad: unknown[] = [
      withdraw('p1', 0),
      withdraw('p1', 1.5),
      withdraw('p1', -5),
      { type: 'bankTransfer', playerId: 'p1', direction: 'sideways', amount: 1 },
      { type: 'bankTransfer', playerId: 'p1', direction: 'withdraw' },
    ];
    for (const action of bad) {
      expect(applyAction(state, action as Action)).toEqual({
        ok: false,
        error: { code: 'invalidAction' },
      });
    }
  });

  it('rejects bank actions outside the bank and from other players', () => {
    expect(applyAction(game(), leave('p1'))).toEqual({
      ok: false,
      error: { code: 'wrongPhase', phase: 'awaitRoll' },
    });
    expect(applyAction(game(), withdraw('p1', 1))).toEqual({
      ok: false,
      error: { code: 'wrongPhase', phase: 'awaitRoll' },
    });
    expect(applyAction(paused(), leave('p2'))).toEqual({
      ok: false,
      error: { code: 'notYourTurn' },
    });
    expect(applyAction(paused(), roll('p1'))).toEqual({
      ok: false,
      error: { code: 'wrongPhase', phase: 'bank' },
    });
  });

  it('accepts the bounds of each range', () => {
    const state = paused();
    expect(applyAction(state, withdraw('p1', 1)).ok).toBe(true);
    expect(applyAction(state, withdraw('p1', 20_000)).ok).toBe(true);
    expect(applyAction(state, deposit('p1', 20_000)).ok).toBe(true);
  });

  it('is left by computerAction for a computer seat, never for a human', () => {
    // Computers never open a bank; Phase 4 stand-ins for humans will (docs/BANK_PLAN.md).
    const state = paused();
    expect(computerAction(state, 'p1')).toBeNull();
    const computer = patchPlayer(state, 'p1', {
      controller: 'computer',
      profile: { cashPercent: 50, loanPercent: 50 },
    });
    expect(computerAction(computer, 'p1')).toEqual(leave('p1'));
  });

  it('is sent to clients', () => {
    expect(viewFor(paused(), { kind: 'spectator' }).turn.phase).toEqual(PAUSED);
  });
});

describe('bank phase invariants', () => {
  const at = (phase: Phase, tile = 1) => patchTurn(placePlayer(game(), 'p1', tile), { phase });

  it('holds for a consistent bank phase', () => {
    expect(checkInvariants(at(PAUSED))).toEqual([]);
    expect(checkInvariants(at({ kind: 'bank', tile: 3, trigger: { kind: 'land' } }, 3))).toEqual(
      [],
    );
  });

  it('reports a bank phase away from the player or off a bank', () => {
    expect(checkInvariants(at(PAUSED, 3))).toEqual([
      'phase bank: tile 1 is not where p1 stands (3)',
    ]);
    expect(checkInvariants(at({ ...PAUSED, tile: 2 }, 2))).toEqual([
      'phase bank: tile 2 is not a bank',
    ]);
  });

  it('reports steps left that are not a positive integer', () => {
    expect(checkInvariants(at({ ...PAUSED, trigger: { kind: 'pass', stepsLeft: 0 } }))).toEqual([
      'phase bank: stepsLeft 0 is not a positive integer',
    ]);
  });

  it('reports a computer at a bank', () => {
    const state = patchPlayer(at(PAUSED), 'p1', {
      controller: 'computer',
      profile: { cashPercent: 50, loanPercent: 50 },
    });
    expect(checkInvariants(state)).toEqual(['phase bank: p1 is not a human']);
  });
});
