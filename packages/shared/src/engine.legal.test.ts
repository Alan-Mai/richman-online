import { describe, expect, it } from 'vitest';
import type { Action, ActionType, LegalAction } from './actions';
import type { RuleConfig } from './config';
import { actorOf, applyAction, legalActions } from './engine';
import { checkInvariants } from './invariants';
import { createRng, nextInt, type RngState } from './rng';
import type { GameState } from './state';
import {
  applyOk,
  concrete,
  exampleAction,
  loopBoard,
  newTestGame,
  patchPlayer,
  patchTile,
  patchTurn,
  sampleActions,
  unofferedRefusal,
} from './testing';

const ACTION_TYPES: readonly ActionType[] = [
  'rollDice',
  'setDiceCount',
  'buyProperty',
  'upgradeProperty',
  'decline',
  'bid',
  'passRound',
  'withdraw',
  'bankTransfer',
  'leaveBank',
];

/**
 * Plays random legal actions (choices drawn from a separate seeded RNG) and checks at every step
 * that each offered action is accepted, nobody else is offered anything, and unoffered action
 * types are refused. Problems are collected and compared once at the end: an expect per check
 * made this test take seconds (docs/BANK_PLAN.md, batch 3 timeouts).
 */
function playRandomGame(start: GameState, seed: number, maxSteps: number) {
  let state = start;
  let chooser: RngState = createRng(seed ^ 0x5eed);
  let steps = 0;
  let auctionSteps = 0;
  let bankSteps = 0;
  const problems: string[] = [];
  const at = () => `seed ${seed} step ${steps} (${state.turn.phase.kind})`;
  const refusedAs = (action: Action, error: unknown) => {
    const result = applyAction(state, action);
    const expected = JSON.stringify({ ok: false, error });
    if (JSON.stringify(result) !== expected) {
      problems.push(
        `${at()}: ${JSON.stringify(action)} gave ${JSON.stringify(result.ok ? 'ok' : result.error)}, expected ${expected}`,
      );
    }
  };
  while (state.turn.phase.kind !== 'gameOver' && steps < maxSteps) {
    problems.push(...checkInvariants(state).map((e) => `${at()}: ${e}`));
    const current = actorOf(state) ?? '';
    for (const player of state.players) {
      if (player.id !== current && legalActions(state, player.id).length > 0) {
        problems.push(`${at()}: ${player.id} is offered actions out of turn`);
      }
    }

    const legal = legalActions(state, current);
    expect(legal.length, `${at()}: nothing offered`).toBeGreaterThan(0);
    for (const option of legal) {
      for (const action of sampleActions(option)) {
        if (!applyAction(state, action).ok)
          problems.push(`${at()}: ${JSON.stringify(action)} refused`);
      }
      if (option.type === 'bankTransfer') {
        // A range allows exactly 1..max: below is malformed, above is more than there is.
        const outside: [number, string][] = [
          [0, 'invalidAction'],
          [option.max + 1, 'insufficientFunds'],
        ];
        for (const [amount, code] of outside) {
          refusedAs({ ...concrete(option), amount } as Action, { code });
        }
        bankSteps++;
      }
    }
    for (const type of ACTION_TYPES) {
      if (!legal.some((a) => a.type === type)) {
        const error = unofferedRefusal(state, type);
        if (error === null) problems.push(`${at()}: ${type} should have been offered`);
        else refusedAs(exampleAction(type, current), error);
      }
    }

    if (state.turn.phase.kind === 'auction') auctionSteps++;
    const [pick, next] = nextInt(chooser, legal.length);
    chooser = next;
    let action = concrete(legal[pick] as LegalAction);
    if (action.type === 'bankTransfer') {
      const [amount, after] = nextInt(chooser, action.amount);
      chooser = after;
      action = { ...action, amount: amount + 1 };
    }
    const result = applyAction(state, action);
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    state = result.state;
    steps++;
  }
  problems.push(...checkInvariants(state).map((e) => `${at()}: ${e}`));
  expect(problems).toEqual([]);
  return { state, auctionSteps, bankSteps };
}

/** Plays seeds 1–5 and expects at least one of them to finish. */
function expectRandomGamesHold(config: Partial<RuleConfig>, maxSteps: number): void {
  let finished = 0;
  let bankSteps = 0;
  for (const seed of [1, 2, 3, 4, 5]) {
    const start = newTestGame({ config, playerCount: 4, seed });
    const played = playRandomGame(start, seed, maxSteps);
    if (played.state.turn.phase.kind === 'gameOver') finished++;
    bankSteps += played.bankSteps;
  }
  expect(finished).toBeGreaterThan(0);
  // TEST_LOOP_BOARD has banks, so the transfer ranges get checked too.
  expect(bankSteps).toBeGreaterThan(0);
}

describe('legalActions completeness', () => {
  // [name, config, step limit]
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
  ];

  it.each(configs)('holds for random games: %s', (_, config, maxSteps) => {
    expectRandomGamesHold(config, maxSteps);
  });

  // Rent goes into deposits, so last-standing games run long, and random play spends many steps
  // choosing the dice count; this takes a few seconds, more under coverage.
  it('holds for random games: poor players until one is left', () => {
    expectRandomGamesHold({ startingFunds: 2000, startingVehicle: 'motorbike' }, 5000);
  }, 30_000);

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
      const [option] = legalActions(state, actor ?? '');
      if (option === undefined) break;
      state = applyOk(state, concrete(option)).state;
    }
  });
});
