import { describe, expect, it } from 'vitest';
import type { Action, ActionType } from './actions';
import type { RuleConfig } from './config';
import { applyAction, legalActions } from './engine';
import { checkInvariants } from './invariants';
import { createRng, nextInt, type RngState } from './rng';
import { newTestGame } from './testing';

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
  const configs: [string, Partial<RuleConfig>][] = [
    ['defaults with a round limit', { winCondition: 'richestAtRoundLimit', maxRounds: 25 }],
    [
      'poor players, cash and deposit, full payout',
      {
        winCondition: 'richestAtRoundLimit',
        maxRounds: 40,
        startingCash: 1500,
        startingDeposit: 1500,
        purchaseFunds: 'cashAndDeposit',
        bankruptcyPayout: 'full',
      },
    ],
    [
      'poor players until one is left, start bonus, no payout',
      {
        startingCash: 2000,
        startingDeposit: 0,
        passStartBonus: 300,
        bankruptcyPayout: 'none',
        defaultDiceCount: 2,
      },
    ],
  ];

  it.each(configs)('holds for random games: %s', (_, config) => {
    let finished = 0;
    for (const seed of [1, 2, 3, 4, 5]) {
      const end = playRandomGame(config, seed, 600);
      if (end.turn.phase.kind === 'gameOver') finished++;
    }
    expect(finished).toBeGreaterThan(0);
  });
});
