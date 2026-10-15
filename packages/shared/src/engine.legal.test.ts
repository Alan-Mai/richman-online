import { describe, expect, it } from 'vitest';
import type { Action, ActionType } from './actions';
import type { RuleConfig } from './config';
import { actorOf, applyAction, legalActions } from './engine';
import { checkInvariants } from './invariants';
import { createRng, nextInt, type RngState } from './rng';
import type { GameState } from './state';
import {
  applyOk,
  exampleAction,
  loopBoard,
  newTestGame,
  patchPlayer,
  patchTile,
  patchTurn,
} from './testing';

const ACTION_TYPES: readonly ActionType[] = [
  'rollDice',
  'buyProperty',
  'upgradeProperty',
  'decline',
  'bid',
  'passRound',
  'withdraw',
];

/**
 * Plays random legal actions (choices drawn from a separate seeded RNG) and checks at every step
 * that each offered action is accepted, nobody else is offered anything, and unoffered action
 * types are refused.
 */
function playRandomGame(start: GameState, seed: number, maxSteps: number) {
  let state = start;
  let chooser: RngState = createRng(seed ^ 0x5eed);
  let steps = 0;
  let auctionSteps = 0;
  while (state.turn.phase.kind !== 'gameOver' && steps < maxSteps) {
    expect(checkInvariants(state)).toEqual([]);
    const current = actorOf(state) ?? '';
    for (const player of state.players) {
      if (player.id !== current) expect(legalActions(state, player.id)).toEqual([]);
    }

    const legal = legalActions(state, current);
    expect(legal.length).toBeGreaterThan(0);
    for (const action of legal) expect(applyAction(state, action).ok).toBe(true);
    for (const type of ACTION_TYPES) {
      if (!legal.some((a) => a.type === type)) {
        expect(applyAction(state, exampleAction(type, current))).toEqual({
          ok: false,
          error: { code: 'wrongPhase', phase: state.turn.phase.kind },
        });
      }
    }

    if (state.turn.phase.kind === 'auction') auctionSteps++;
    const [pick, next] = nextInt(chooser, legal.length);
    chooser = next;
    const result = applyAction(state, legal[pick] as Action);
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    state = result.state;
    steps++;
  }
  expect(checkInvariants(state)).toEqual([]);
  return { state, auctionSteps };
}

describe('legalActions completeness', () => {
  // [name, config, step limit]; rent goes into deposits, so last-standing games run long.
  const configs: [string, Partial<RuleConfig>, number][] = [
    ['defaults with a day limit', { dayLimit: 25 }, 600],
    [
      'poor players',
      {
        dayLimit: 40,
        startingFunds: 3000,
      },
      600,
    ],
    [
      'poor players until one is left',
      {
        startingFunds: 2000,
        startingVehicle: 'motorbike',
      },
      2000,
    ],
  ];

  it.each(configs)('holds for random games: %s', (_, config, maxSteps) => {
    let finished = 0;
    for (const seed of [1, 2, 3, 4, 5]) {
      const start = newTestGame({ config, playerCount: 4, seed });
      const end = playRandomGame(start, seed, maxSteps).state;
      if (end.turn.phase.kind === 'gameOver') finished++;
    }
    expect(finished).toBeGreaterThan(0);
  });

  it('holds through bankruptcy auctions', () => {
    // Random play rarely gets there: rent goes into deposits, so cash only ever falls and bidders
    // with enough cash are scarce. Start instead with every player owning 4 built properties, seat
    // 0 poor and the others rich, so bankruptcies come with open auctions.
    const board = loopBoard(Array.from({ length: 16 }, () => 2000));
    let auctionSteps = 0;
    for (const seed of [1, 2, 3, 4, 5]) {
      let start = newTestGame({
        board,
        playerCount: 4,
        seed,
        config: { startingVehicle: 'motorbike' },
      });
      start.players.forEach((p, seat) => {
        start = patchPlayer(start, p.id, { cash: seat === 0 ? 3000 : 40_000, deposit: 0 });
        for (let k = 0; k < 4; k++)
          start = patchTile(start, seat + 4 * k, { owner: p.id, level: 3 });
      });
      auctionSteps += playRandomGame(start, seed, 2000).auctionSteps;
    }
    expect(auctionSteps).toBeGreaterThan(20);
  });
});

describe('actorOf', () => {
  it('is the current player outside auctions', () => {
    const state = patchTurn(newTestGame({ playerCount: 3 }), { current: 'p2' });
    expect(actorOf(state)).toBe('p2');
    const buying = patchTurn(state, { phase: { kind: 'awaitBuyDecision', tile: 1, price: 1 } });
    expect(actorOf(buying)).toBe('p2');
    const upgrading = patchTurn(state, {
      phase: { kind: 'awaitUpgradeDecision', tile: 1, cost: 1 },
    });
    expect(actorOf(upgrading)).toBe('p2');
  });

  it('is nobody once the game is over', () => {
    const state = patchTurn(newTestGame(), { phase: { kind: 'gameOver', winners: ['p1'] } });
    expect(actorOf(state)).toBeNull();
  });

  it('is the only player offered actions in random games', () => {
    let state = newTestGame({ playerCount: 3, controllers: ['human', 'computer', 'human'] });
    for (let step = 0; step < 200 && state.turn.phase.kind !== 'gameOver'; step++) {
      const actor = actorOf(state);
      expect(actor).not.toBeNull();
      for (const player of state.players) {
        expect(legalActions(state, player.id).length > 0).toBe(player.id === actor);
      }
      const [action] = legalActions(state, actor ?? '');
      if (action === undefined) break;
      state = applyOk(state, action).state;
    }
  });
});
