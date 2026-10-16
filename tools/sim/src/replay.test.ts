import { describe, expect, it } from 'vitest';
import { ENGINE, runGame, type Engine, type GameSpec } from './game';
import { parseGameLog, replay, reproduces, toGameLog, type GameLog } from './replay';

const RICHEST: GameSpec = {
  board: 'test-loop',
  controllers: 'random',
  vehicle: 'walk',
  seed: 7,
  dayLimit: 10,
  netWorthTargetMultiple: null,
  maxDays: 1000,
  maxSteps: 20_000,
};

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
  it('replays a game on the branch board', () => {
    const spec: GameSpec = { ...RICHEST, board: 'test-branch' };
    const log = toGameLog(spec, runGame(spec));
    expect(log.board).toBe('test-branch');
    const parsed = parseGameLog(JSON.stringify(log));
    if (!parsed.ok) throw new Error(parsed.errors.join('; '));
    expect(replay(parsed.log).kind).toBe('completed');
  });

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

  it('reproduces games left unfinished at the day cap and step-limit failures', () => {
    const unfinished: GameSpec = { ...RICHEST, seed: 3, dayLimit: null, maxDays: 4 };
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
    [
      'an older version',
      edit({ version: 1 }),
      'unsupported log version 1 (expected 9; logs from older engines cannot be replayed)',
    ],
    [
      'a version 5 log, from before the calendar',
      edit({ version: 5 }),
      'unsupported log version 5 (expected 9; logs from older engines cannot be replayed): ' +
        'its config has no startDate (the calendar came in log version 6)',
    ],
    [
      'a version 6 log, from before computer profiles',
      edit({ version: 6 }),
      'unsupported log version 6 (expected 9; logs from older engines cannot be replayed): ' +
        'its computer seats have no profile and split their starting funds like humans ' +
        '(profiles came in log version 7)',
    ],
    [
      'a version 7 log, from before banks',
      edit({ version: 7 }),
      'unsupported log version 7 (expected 9; logs from older engines cannot be replayed): ' +
        'humans did not stop at banks (banks came in log version 8)',
    ],
    [
      'a version 8 log, from before rebalancing',
      edit({ version: 8 }),
      'unsupported log version 8 (expected 9; logs from older engines cannot be replayed): ' +
        'computers did not rebalance at banks (rebalancing came in log version 9)',
    ],
    ['an unknown board', edit({ board: 'elsewhere' }), 'unknown board elsewhere'],
    ['a missing config', edit({ config: null }), 'config must be an object'],
    [
      'bad players',
      edit({ players: [{ id: 1 }] }),
      'players must be {id, name, controller} strings',
    ],
    ['a non-numeric seed', edit({ seed: '7' }), 'seed must be a number'],
    ['missing actions', edit({ actions: 'none' }), 'actions must be an array of objects'],
  ];

  it.each(invalid)('rejects %s', (_, text, error) => {
    expect(parseGameLog(text)).toEqual({ ok: false, errors: [error] });
  });
});
