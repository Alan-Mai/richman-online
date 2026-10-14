import type { Action, GameState, Result } from '@richman/shared';
import { describe, expect, it } from 'vitest';
import {
  BOARDS,
  ENGINE,
  chooserSeedFor,
  gameSeedFor,
  runGame,
  type Engine,
  type GameRecord,
  type GameSpec,
} from './game';

const RICHEST: GameSpec = {
  board: 'test-loop',
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
