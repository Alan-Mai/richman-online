import { describe, expect, it } from 'vitest';
import { ENGINE, runGame, type Engine, type GameSpec } from './game';
import { parseGameLog, replay, reproduces, toGameLog, type GameLog } from './replay';

const RICHEST: GameSpec = { seed: 7, win: 'richestAtRoundLimit', maxRounds: 10, maxSteps: 10_000 };

/** Breaks once round 3 starts. */
const BROKEN: Engine = {
  ...ENGINE,
  checkInvariants: (state) => (state.turn.round >= 3 ? ['turn: broken'] : []),
};

/** Serializes and parses back, as main does with the failure file. */
function roundTrip(log: GameLog): GameLog {
  const parsed = parseGameLog(JSON.stringify(log));
  if (!parsed.ok) throw new Error(parsed.errors.join('; '));
  return parsed.log;
}

describe('replay', () => {
  it('replays a finished game to its end', () => {
    const record = runGame(RICHEST);
    const log = roundTrip(toGameLog(RICHEST, record));
    const result = replay(log);
    expect(result).toMatchObject({ kind: 'completed', steps: record.actions.length });
    if (result.kind === 'completed') {
      expect(result.state.turn.phase.kind).toBe('gameOver');
    }
    expect(reproduces(log, result)).toBe(true);
  });

  it('reproduces a failure at the same step with the same engine', () => {
    const record = runGame(RICHEST, BROKEN);
    const log = roundTrip(toGameLog(RICHEST, record));
    const result = replay(log, BROKEN);
    expect(result).toEqual(record.outcome);
    expect(reproduces(log, result)).toBe(true);

    const fixed = replay(log);
    expect(fixed.kind).toBe('completed');
    expect(reproduces(log, fixed)).toBe(false);
  });

  it('reproduces unfinished lastStanding games and step-limit failures', () => {
    const unfinished: GameSpec = { seed: 3, win: 'lastStanding', maxRounds: null, maxSteps: 25 };
    const log = toGameLog(unfinished, runGame(unfinished));
    expect(reproduces(log, replay(log))).toBe(true);

    const limited: GameSpec = { ...RICHEST, maxSteps: 25 };
    const limitedLog = toGameLog(limited, runGame(limited));
    expect(limitedLog.outcome).toMatchObject({ kind: 'failed', failure: { kind: 'stepLimit' } });
    expect(reproduces(limitedLog, replay(limitedLog))).toBe(true);
  });

  it('stops at a logged action that is not legal', () => {
    const log = toGameLog(RICHEST, runGame(RICHEST));
    const actions = [...log.actions];
    actions[3] = { type: 'buyProperty', playerId: 'p4' };
    expect(replay({ ...log, actions })).toEqual({
      kind: 'failed',
      step: 3,
      failure: { kind: 'notOffered', action: { type: 'buyProperty', playerId: 'p4' } },
    });
  });

  it('reports a setup the engine rejects', () => {
    const log = toGameLog(RICHEST, runGame(RICHEST));
    expect(replay({ ...log, seed: -1 })).toEqual({
      kind: 'failed',
      step: 0,
      failure: { kind: 'createGame', errors: [{ reason: 'invalidSeed' }] },
    });
  });

  it('reports engine exceptions as failures', () => {
    const log = toGameLog(RICHEST, runGame(RICHEST));
    const throwing: Engine = {
      ...ENGINE,
      checkInvariants: () => {
        throw new Error('kaboom');
      },
    };
    expect(replay(log, throwing)).toMatchObject({
      kind: 'failed',
      step: 0,
      failure: { kind: 'exception', message: 'kaboom' },
    });
  });
});

describe('parseGameLog', () => {
  const valid = JSON.stringify(toGameLog(RICHEST, runGame(RICHEST)));
  const edit = (patch: Record<string, unknown>) =>
    JSON.stringify({ ...JSON.parse(valid), ...patch });

  it('accepts what toGameLog writes', () => {
    expect(parseGameLog(valid).ok).toBe(true);
  });

  const invalid: [string, string, string][] = [
    ['broken JSON', '{', 'not valid JSON'],
    ['a non-object', '[]', 'not a game log object'],
    ['another version', edit({ version: 2 }), 'unsupported log version 2'],
    ['an unknown board', edit({ board: 'elsewhere' }), 'unknown board elsewhere'],
    ['a missing config', edit({ config: null }), 'config must be an object'],
    ['bad players', edit({ players: [{ id: 1 }] }), 'players must be {id, name} strings'],
    ['a non-numeric seed', edit({ seed: '7' }), 'seed must be a number'],
    ['missing actions', edit({ actions: 'none' }), 'actions must be an array of objects'],
  ];

  it.each(invalid)('rejects %s', (_, text, error) => {
    expect(parseGameLog(text)).toEqual({ ok: false, errors: [error] });
  });
});
