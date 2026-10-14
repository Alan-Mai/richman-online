import { describe, expect, it } from 'vitest';
import type { Action, ActionType } from './actions';
import type { RuleConfig } from './config';
import { actorOf, applyAction, legalActions } from './engine';
import { checkInvariants } from './invariants';
import { createRng, nextInt, type RngState } from './rng';
import { applyOk, newTestGame, patchTurn } from './testing';

const ACTION_TYPES: readonly ActionType[] = [
  'rollDice',
  'buyProperty',
  'upgradeProperty',
  'decline',
];

/**
 * Plays random legal actions (choices drawn from a separate seeded RNG) and checks at every step
 * that each offered action is accepted, nobody else is offered anything, and unoffered action
 * types are refused.
 */
function playRandomGame(config: Partial<RuleConfig>, seed: number, maxSteps: number) {
  let state = newTestGame({ config, playerCount: 4, seed });
  let chooser: RngState = createRng(seed ^ 0x5eed);
  let steps = 0;
  while (state.turn.phase.kind !== 'gameOver' && steps < maxSteps) {
    expect(checkInvariants(state)).toEqual([]);
    const current = state.turn.current;
    for (const player of state.players) {
      if (player.id !== current) expect(legalActions(state, player.id)).toEqual([]);
    }

    const legal = legalActions(state, current);
    expect(legal.length).toBeGreaterThan(0);
    for (const action of legal) expect(applyAction(state, action).ok).toBe(true);
    for (const type of ACTION_TYPES) {
      if (!legal.some((a) => a.type === type)) {
        expect(applyAction(state, { type, playerId: current })).toEqual({
          ok: false,
          error: { code: 'wrongPhase', phase: state.turn.phase.kind },
        });
      }
    }

    const [pick, next] = nextInt(chooser, legal.length);
    chooser = next;
    const result = applyAction(state, legal[pick] as Action);
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    state = result.state;
    steps++;
  }
  expect(checkInvariants(state)).toEqual([]);
  return state;
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
        defaultDiceCount: 2,
      },
      2000,
    ],
  ];

  it.each(configs)('holds for random games: %s', (_, config, maxSteps) => {
    let finished = 0;
    for (const seed of [1, 2, 3, 4, 5]) {
      const end = playRandomGame(config, seed, maxSteps);
      if (end.turn.phase.kind === 'gameOver') finished++;
    }
    expect(finished).toBeGreaterThan(0);
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
