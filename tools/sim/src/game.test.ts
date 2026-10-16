import {
  PROVISIONAL_COMPUTER_PROFILE,
  allows,
  type Action,
  type GameState,
  type Result,
} from '@richman/shared';
import { describe, expect, it } from 'vitest';
import {
  BOARDS,
  ENGINE,
  MAX_AUCTION_ACTIONS,
  chooserSeedFor,
  gameSetup,
  gameSeedFor,
  runGame,
  type Engine,
  type GameRecord,
  type GameSpec,
} from './game';
import { replay, reproduces, toGameLog } from './replay';

const RICHEST: GameSpec = {
  board: 'test-loop',
  controllers: 'random',
  vehicle: 'walk',
  seed: 1,
  dayLimit: 100,
  netWorthTargetMultiple: null,
  maxDays: 1000,
  maxSteps: 20_000,
};

function failureOf(record: GameRecord) {
  if (record.outcome.kind !== 'failed') {
    throw new Error(`expected a failure, got ${record.outcome.kind}`);
  }
  return record.outcome;
}

/** The real engine with applyAction replaced for one action type. */
function overrideApply(
  type: Action['type'],
  apply: (state: GameState, action: Action) => Result,
): Engine {
  return {
    ...ENGINE,
    applyAction: (state, action) =>
      action.type === type ? apply(state, action) : ENGINE.applyAction(state, action),
  };
}

describe('seeds', () => {
  it('derives game seeds from the run seed and wraps at 2^32', () => {
    expect(gameSeedFor(10, 0)).toBe(10);
    expect(gameSeedFor(10, 5)).toBe(15);
    expect(gameSeedFor(0xffff_ffff, 2)).toBe(1);
  });

  it('derives a distinct uint32 chooser seed', () => {
    expect(chooserSeedFor(1)).toBe((1 ^ 0x5eed) >>> 0);
    expect(chooserSeedFor(0xffff_ffff)).toBeGreaterThan(0);
  });
});

describe('runGame', () => {
  it('is reproducible from the seed', () => {
    expect(runGame(RICHEST)).toEqual(runGame(RICHEST));
    expect(runGame({ ...RICHEST, seed: 2 }).actions).not.toEqual(runGame(RICHEST).actions);
  });

  it('finishes day-limited games on the day limit', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const record = runGame({ ...RICHEST, seed, dayLimit: 5 });
      expect(record.outcome.kind).toBe('finished');
      expect(record.rounds).toBeLessThanOrEqual(5);
      expect(record.actions.length).toBeGreaterThan(0);
    }
  });

  it('reports the end reason, the winning seats and bankruptcies', () => {
    const record = runGame({ ...RICHEST, dayLimit: 3 });
    expect(record.outcome).toMatchObject({ kind: 'finished', reason: 'dayLimitOrNetWorthTarget' });
    if (record.outcome.kind === 'finished') {
      expect(record.outcome.winnerSeats).toHaveLength(1);
      expect(record.outcome.winnerSeats.every((s) => s >= 0 && s < 4)).toBe(true);
    }
    expect(record.bankruptcies).toBe(0);
  });

  it('ends net worth target games by the target', () => {
    const record = runGame({ ...RICHEST, dayLimit: null, netWorthTargetMultiple: 1 });
    expect(record.outcome).toMatchObject({ kind: 'finished', reason: 'dayLimitOrNetWorthTarget' });
  });

  it('leaves games unfinished at the safety cap on days, which is not a failure', () => {
    const record = runGame({ ...RICHEST, dayLimit: null, maxDays: 2 });
    expect(record.outcome).toEqual({ kind: 'unfinished' });
    expect(record.rounds).toBe(3);
  });

  it('fails games that hit the step limit', () => {
    const record = runGame({ ...RICHEST, maxSteps: 3 });
    expect(failureOf(record)).toEqual({
      kind: 'failed',
      step: 3,
      failure: { kind: 'stepLimit', maxSteps: 3 },
    });
  });
});

describe('runGame failure detection', () => {
  it('reports a rejected setup', () => {
    const engine: Engine = {
      ...ENGINE,
      createGame: () => ({ ok: false, errors: [{ reason: 'invalidSeed' }] }),
    };
    expect(failureOf(runGame(RICHEST, engine))).toEqual({
      kind: 'failed',
      step: 0,
      failure: { kind: 'createGame', errors: [{ reason: 'invalidSeed' }] },
    });
  });

  it('reports a transfer or rebalance that changes cash + deposit, and replays it', () => {
    /** The engine, but the money moved at a bank grows by 1 for the mover. */
    const leaky = (bankEvent: 'BankTransferred' | 'BankRebalanced'): Engine => ({
      ...ENGINE,
      applyAction: (state, action) => {
        const result = ENGINE.applyAction(state, action);
        const event = result.ok ? result.events.find((e) => e.type === bankEvent) : undefined;
        if (!result.ok || event === undefined || !('playerId' in event)) return result;
        const grow = (p: GameState['players'][number]) =>
          p.id === event.playerId ? { ...p, cash: p.cash + 1 } : p;
        const events = result.events.map((e) =>
          e === event && e.type === 'BankRebalanced' ? { ...e, cash: e.cash + 1 } : e,
        );
        return {
          ...result,
          events,
          state: { ...result.state, players: result.state.players.map(grow) },
        };
      },
    });
    const cases: [GameSpec, Engine][] = [
      [RICHEST, leaky('BankTransferred')],
      [{ ...RICHEST, controllers: 'computer' }, leaky('BankRebalanced')],
    ];
    for (const [spec, engine] of cases) {
      const record = runGame(spec, engine);
      const outcome = failureOf(record);
      expect(outcome.failure).toMatchObject({ kind: 'bankChangedTotal' });
      if (outcome.failure.kind !== 'bankChangedTotal') continue;
      expect(outcome.failure.after).toBe(outcome.failure.before + 1);
      const log = toGameLog(spec, record);
      expect(reproduces(log, replay(log, engine))).toBe(true);
    }
  });

  it('reports invariant violations with the step', () => {
    const engine: Engine = {
      ...ENGINE,
      checkInvariants: (state) => (state.turn.round >= 2 ? ['player p1: broken'] : []),
    };
    const outcome = failureOf(runGame(RICHEST, engine));
    expect(outcome.failure).toEqual({ kind: 'invariant', violations: ['player p1: broken'] });
    expect(outcome.step).toBeGreaterThan(0);
  });

  it('reports a falling price index', () => {
    const engine: Engine = {
      ...ENGINE,
      createGame: (setup) => {
        const created = ENGINE.createGame(setup);
        return created.ok ? { ...created, state: { ...created.state, priceIndex: 5 } } : created;
      },
      applyAction: (state, action) => {
        const result = ENGINE.applyAction(state, action);
        return result.ok
          ? { ...result, state: { ...result.state, priceIndex: state.priceIndex - 1 } }
          : result;
      },
    };
    expect(failureOf(runGame(RICHEST, engine))).toEqual({
      kind: 'failed',
      step: 1,
      failure: { kind: 'priceIndexFell', from: 5, to: 4 },
    });
  });

  it('reports a missing legal action', () => {
    const engine: Engine = { ...ENGINE, legalActions: () => [] };
    expect(failureOf(runGame(RICHEST, engine)).failure).toEqual({
      kind: 'noLegalActions',
      playerId: 'p1',
    });
  });

  it('reports actions offered out of turn', () => {
    const engine: Engine = {
      ...ENGINE,
      legalActions: (_, playerId) => [{ type: 'rollDice', playerId }],
    };
    expect(failureOf(runGame(RICHEST, engine)).failure).toEqual({
      kind: 'offeredOutOfTurn',
      playerId: 'p2',
      actions: [{ type: 'rollDice', playerId: 'p2' }],
    });
  });

  it('reports offered actions that are rejected', () => {
    const engine = overrideApply('buyProperty', (state, action) =>
      state.turn.phase.kind === 'awaitBuyDecision'
        ? { ok: false, error: { code: 'insufficientFunds' } }
        : ENGINE.applyAction(state, action),
    );
    const outcome = failureOf(runGame(RICHEST, engine));
    expect(outcome.failure).toMatchObject({
      kind: 'legalActionRejected',
      action: { type: 'buyProperty' },
      error: { code: 'insufficientFunds' },
    });
  });

  it('reports unoffered actions that are not refused with wrongPhase', () => {
    const engine = overrideApply('upgradeProperty', (state) => ({ ok: true, state, events: [] }));
    expect(failureOf(runGame(RICHEST, engine))).toEqual({
      kind: 'failed',
      step: 0,
      failure: {
        kind: 'unofferedNotRefused',
        action: { type: 'upgradeProperty', playerId: 'p1' },
        outcome: 'accepted',
        expected: 'wrongPhase',
      },
    });
  });

  it('reports exceptions with their message', () => {
    const engine = overrideApply('decline', () => {
      throw new Error('kaboom');
    });
    const outcome = failureOf(runGame(RICHEST, engine));
    expect(outcome.failure).toMatchObject({ kind: 'exception', message: 'kaboom' });
  });

  it('reports a game over without GameEnded', () => {
    const engine: Engine = {
      ...ENGINE,
      applyAction: (state, action) => {
        const result = ENGINE.applyAction(state, action);
        return result.ok
          ? { ...result, events: result.events.filter((e) => e.type !== 'GameEnded') }
          : result;
      },
    };
    expect(failureOf(runGame({ ...RICHEST, dayLimit: 2 }, engine)).failure).toEqual({
      kind: 'missingGameEnded',
    });
  });
});

describe('BOARDS', () => {
  it('keys every built-in board by its id', () => {
    for (const [name, board] of Object.entries(BOARDS)) expect(board.id).toBe(name);
  });

  it('plays clean games on the branch board', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const record = runGame({ ...RICHEST, board: 'test-branch', seed });
      expect(record.outcome.kind).toBe('finished');
    }
  });
});

/** The real engine, but every game starts with seat 1 poor and the others rich, each owning 4. */
function auctionEngine(): Engine {
  return {
    ...ENGINE,
    createGame: (setup) => {
      const created = ENGINE.createGame(setup);
      if (!created.ok) return created;
      const { state } = created;
      const properties = state.board.tiles.flatMap((t, i) => (t.kind === 'property' ? [i] : []));
      const players = state.players.map((p, seat) => ({
        ...p,
        cash: seat === 0 ? 3000 : 40_000,
        deposit: 0,
      }));
      const tiles = state.tiles.map((tile, i) => {
        const k = properties.indexOf(i);
        return k >= 0 && k < 16 ? { owner: players[k % 4]!.id, level: 3 } : tile;
      });
      return { ...created, state: { ...state, players, tiles } };
    },
  };
}

describe('runGame players', () => {
  it('seats computers as the controller mode says', () => {
    const controllers = (mode: GameSpec['controllers']) =>
      gameSetup({ ...RICHEST, controllers: mode }).players.map((p) => p.controller);
    expect(controllers('random')).toEqual(['human', 'human', 'human', 'human']);
    // Seat 1 stays human: a game without humans ends at its first bankruptcy.
    expect(controllers('computer')).toEqual(['human', 'computer', 'computer', 'computer']);
    expect(controllers('mixed')).toEqual(['human', 'computer', 'human', 'computer']);
  });

  it('gives computers the provisional profile without --tables', () => {
    const profiles = gameSetup({ ...RICHEST, controllers: 'computer' }).players.map((p) =>
      p.controller === 'computer' ? p.profile : null,
    );
    expect(profiles).toEqual([
      null,
      ...Array.from({ length: 3 }, () => PROVISIONAL_COMPUTER_PROFILE),
    ]);
  });

  it('draws different characters per game from --tables, the same for the same seed', () => {
    // Made-up profiles: cashPercent 10, 20, ..., 120 would be out of range, so 1..12.
    const profiles = Array.from({ length: 12 }, (_, i) => ({
      cashPercent: i + 1,
      loanPercent: 50,
    }));
    const characters = { path: 'fake.json', profiles };
    const drawn = (seed: number) =>
      gameSetup({ ...RICHEST, seed, controllers: 'computer', characters }).players.flatMap((p) =>
        p.controller === 'computer' ? [p.profile.cashPercent] : [],
      );
    const seen = new Set<string>();
    for (let seed = 1; seed <= 30; seed++) {
      const picks = drawn(seed);
      expect(picks).toHaveLength(3);
      expect(new Set(picks).size).toBe(3);
      expect(drawn(seed)).toEqual(picks);
      seen.add(picks.join(','));
    }
    expect(seen.size).toBeGreaterThan(20);
  });

  it('refuses more computer seats than characters', () => {
    const characters = { path: 'fake.json', profiles: [PROVISIONAL_COMPUTER_PROFILE] };
    expect(() => gameSetup({ ...RICHEST, controllers: 'computer', characters })).toThrow(
      RangeError,
    );
  });

  it("plays computer seats with computerAction's choice", () => {
    const spec: GameSpec = { ...RICHEST, controllers: 'mixed', dayLimit: 20 };
    const record = runGame(spec);
    expect(record.outcome.kind).toBe('finished');
    const created = ENGINE.createGame(gameSetup(spec));
    if (!created.ok) throw new Error('setup rejected');
    let state = created.state;
    let computerMoves = 0;
    for (const action of record.actions) {
      const picked = ENGINE.computerAction(state, action.playerId);
      if (picked !== null) {
        expect(action).toEqual(picked);
        computerMoves++;
      }
      const result = ENGINE.applyAction(state, action);
      if (!result.ok) throw new Error('logged action rejected');
      state = result.state;
    }
    expect(computerMoves).toBeGreaterThan(10);
  });

  it('records auctions, the lottery pool and the price index', () => {
    let auctions = 0;
    let sold = 0;
    for (let seed = 1; seed <= 5; seed++) {
      const spec: GameSpec = { ...RICHEST, seed, controllers: 'mixed', dayLimit: null };
      const record = runGame(spec, auctionEngine());
      expect(record.outcome.kind).not.toBe('failed');
      const { metrics } = record;
      auctions += metrics.auctions;
      sold += metrics.auctionsSold;
      expect(metrics.auctionsWithBidders).toBeLessThanOrEqual(metrics.auctions);
      expect(metrics.auctionsSold).toBeLessThanOrEqual(metrics.auctionsWithBidders);
      if (metrics.auctionsSold > 0) {
        expect(metrics.lotteryPool).toBeGreaterThan(0);
        expect(metrics.saleRatioSum).toBeGreaterThanOrEqual(metrics.auctionsSold);
      }
      expect(metrics.firstBankruptcyRound).not.toBeNull();
    }
    expect(auctions).toBeGreaterThan(0);
    expect(sold).toBeGreaterThan(0);
  });

  it('counts forks and dead-end turnarounds on the branch board', () => {
    let forks = 0;
    let deadEnds = 0;
    for (let seed = 1; seed <= 5; seed++) {
      const { metrics } = runGame({ ...RICHEST, board: 'test-branch', seed, dayLimit: 30 });
      forks += metrics.forks;
      deadEnds += metrics.deadEnds;
    }
    expect(forks).toBeGreaterThan(0);
    expect(deadEnds).toBeGreaterThan(0);
    expect(runGame({ ...RICHEST, dayLimit: 30 }).metrics).toMatchObject({ forks: 0, deadEnds: 0 });
  });

  it('counts rolls by dice count, set by the starting vehicle and the players', () => {
    const walking = runGame({ ...RICHEST, dayLimit: 30 }).metrics.diceRolls;
    expect(Object.keys(walking)).toEqual(['1']);
    const rolls = { 1: 0, 2: 0, 3: 0 };
    for (const controllers of ['random', 'computer'] as const) {
      const { metrics, outcome } = runGame({
        ...RICHEST,
        vehicle: 'car',
        controllers,
        dayLimit: 30,
      });
      expect(outcome.kind).not.toBe('failed');
      for (const n of [1, 2, 3] as const) rolls[n] += metrics.diceRolls[n] ?? 0;
    }
    expect(rolls[1]).toBeGreaterThan(0);
    expect(rolls[2]).toBeGreaterThan(0);
    expect(rolls[3]).toBeGreaterThan(0);
  });
});

describe('runGame checks on computers, views and auctions', () => {
  it('reports a computer choice that is not offered', () => {
    const engine: Engine = {
      ...ENGINE,
      computerAction: (state, playerId) =>
        ENGINE.computerAction(state, playerId) === null ? null : { type: 'decline', playerId },
    };
    expect(failureOf(runGame({ ...RICHEST, controllers: 'computer' }, engine)).failure).toEqual({
      kind: 'computerActionNotLegal',
      playerId: 'p2',
      action: { type: 'decline', playerId: 'p2' },
    });
  });

  it('reports a computer choice for a human seat', () => {
    const engine: Engine = {
      ...ENGINE,
      // The first offer while waiting to roll is rollDice, an exact action.
      computerAction: (state, playerId) =>
        (ENGINE.legalActions(state, playerId)[0] as Action | undefined) ?? null,
    };
    expect(failureOf(runGame(RICHEST, engine)).failure).toEqual({
      kind: 'computerActionNotLegal',
      playerId: 'p1',
      action: { type: 'rollDice', playerId: 'p1' },
    });
  });

  it('reports hidden state in a view', () => {
    const engine: Engine = {
      ...ENGINE,
      viewFor: (state, viewer) => ({ ...ENGINE.viewFor(state, viewer), lotteryPool: 0 }),
    };
    expect(failureOf(runGame(RICHEST, engine)).failure).toEqual({
      kind: 'viewLeak',
      viewer: 'p1',
      key: 'lotteryPool',
    });
  });

  it("reports a computer's profile in a view", () => {
    // The real viewFor copies players field by field; this one sends them whole.
    const engine: Engine = {
      ...ENGINE,
      viewFor: (state, viewer) => ({ ...ENGINE.viewFor(state, viewer), players: state.players }),
    };
    expect(failureOf(runGame({ ...RICHEST, controllers: 'computer' }, engine)).failure).toEqual({
      kind: 'viewLeak',
      viewer: 'p1',
      key: 'profile',
    });
  });

  it('reports an auction that never ends', () => {
    const base = auctionEngine();
    const engine: Engine = {
      ...base,
      // Bidding moves are accepted but change nothing, so the same bidder keeps being asked.
      applyAction: (state, action) =>
        state.turn.phase.kind === 'auction' &&
        base.legalActions(state, action.playerId).some((option) => allows(option, action))
          ? { ok: true, state, events: [] }
          : base.applyAction(state, action),
    };
    let found = false;
    for (let seed = 1; seed <= 10 && !found; seed++) {
      const spec: GameSpec = { ...RICHEST, seed, controllers: 'mixed', dayLimit: null };
      const { outcome } = runGame({ ...spec, maxSteps: 1_000_000 }, engine);
      if (outcome.kind === 'failed' && outcome.failure.kind === 'auctionTooLong') {
        expect(outcome.failure.actions).toBe(MAX_AUCTION_ACTIONS);
        found = true;
      }
    }
    expect(found).toBe(true);
  });
});
