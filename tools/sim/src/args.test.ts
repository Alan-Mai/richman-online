import { describe, expect, it } from 'vitest';
import { parseCommand, type RunOptions } from './args';

const DEFAULTS: RunOptions = {
  board: 'test-loop',
  controllers: 'random',
  games: 1000,
  seed: 1,
  dayLimit: null,
  netWorthTargetMultiple: null,
  maxDays: 1000,
  maxSteps: 20_000,
  maxFailureDetails: 5,
};

describe('parseCommand', () => {
  it('uses the defaults without arguments', () => {
    expect(parseCommand([])).toEqual({ ok: true, command: { kind: 'run', options: DEFAULTS } });
  });

  it('ignores the -- separator that pnpm forwards', () => {
    expect(parseCommand(['--', '--games', '3'])).toEqual({
      ok: true,
      command: { kind: 'run', options: { ...DEFAULTS, games: 3 } },
    });
  });

  it('reads every run option', () => {
    const argv = [
      '--games=20',
      '--controllers',
      'mixed',
      '--seed',
      '4294967295',
      '--day-limit',
      '7',
      '--net-worth-target',
      '3',
      '--max-days',
      '9',
      '--max-steps',
      '50',
      '--max-failure-details',
      '0',
    ];
    expect(parseCommand(argv)).toEqual({
      ok: true,
      command: {
        kind: 'run',
        options: {
          board: 'test-loop',
          controllers: 'mixed',
          games: 20,
          seed: 4294967295,
          dayLimit: 7,
          netWorthTargetMultiple: 3,
          maxDays: 9,
          maxSteps: 50,
          maxFailureDetails: 0,
        },
      },
    });
  });

  it('scales the default step limit with the day cap', () => {
    expect(parseCommand(['--max-days', '30'])).toEqual({
      ok: true,
      command: { kind: 'run', options: { ...DEFAULTS, maxDays: 30, maxSteps: 600 } },
    });
  });

  it('picks who plays the seats', () => {
    for (const controllers of ['random', 'computer', 'mixed'] as const) {
      expect(parseCommand(['--controllers', controllers])).toEqual({
        ok: true,
        command: { kind: 'run', options: { ...DEFAULTS, controllers } },
      });
    }
    expect(parseCommand(['--controllers', 'robots'])).toEqual({
      ok: false,
      errors: ['--controllers must be random, computer, mixed, got robots'],
    });
  });

  it('picks a built-in board', () => {
    expect(parseCommand(['--board', 'test-branch'])).toEqual({
      ok: true,
      command: { kind: 'run', options: { ...DEFAULTS, board: 'test-branch' } },
    });
  });

  it('parses replay with a file', () => {
    expect(parseCommand(['replay', 'out/failure-7.json'])).toEqual({
      ok: true,
      command: { kind: 'replay', file: 'out/failure-7.json' },
    });
  });

  const invalid: [string, string[], string][] = [
    ['zero games', ['--games', '0'], '--games must be a positive integer, got 0'],
    ['fractional games', ['--games', '1.5'], '--games must be a positive integer, got 1.5'],
    ['negative seed', ['--seed', '-1'], '--seed must be an integer in 0..4294967295, got -1'],
    [
      'seed beyond uint32',
      ['--seed', '4294967296'],
      '--seed must be an integer in 0..4294967295, got 4294967296',
    ],
    ['empty seed', ['--seed='], '--seed must be an integer in 0..4294967295, got '],
    [
      'unknown board',
      ['--board', 'atlantis'],
      '--board must be test-loop or test-branch, got atlantis',
    ],
    ['the removed --win', ['--win=lastStanding'], 'unknown option --win'],
    ['zero day-limit', ['--day-limit', '0'], '--day-limit must be a positive integer, got 0'],
    [
      'zero net-worth-target',
      ['--net-worth-target', '0'],
      '--net-worth-target must be a positive integer, got 0',
    ],
    ['zero max-days', ['--max-days', '0'], '--max-days must be a positive integer, got 0'],
    [
      'a day limit beyond the day cap',
      ['--day-limit', '50', '--max-days', '40'],
      '--day-limit 50 exceeds --max-days 40',
    ],
    ['zero max-steps', ['--max-steps', '0'], '--max-steps must be a positive integer, got 0'],
    [
      'negative failure details',
      ['--max-failure-details', '-2'],
      '--max-failure-details must be a non-negative integer, got -2',
    ],
    ['replay without a file', ['replay'], 'replay needs exactly one file'],
    ['replay with two files', ['replay', 'a.json', 'b.json'], 'replay needs exactly one file'],
    [
      'replay with run options',
      ['replay', 'a.json', '--games', '2'],
      'replay takes no options, got --games',
    ],
    ['an unknown command', ['run'], 'unknown command run'],
  ];

  it.each(invalid)('rejects %s', (_, argv, error) => {
    expect(parseCommand(argv)).toEqual({ ok: false, errors: [error] });
  });

  it('rejects unknown options without throwing', () => {
    const result = parseCommand(['--gmaes', '3']);
    expect(result.ok).toBe(false);
  });

  it('reports every problem at once', () => {
    expect(parseCommand(['--games', 'x', '--max-steps', '-1'])).toEqual({
      ok: false,
      errors: [
        '--games must be a positive integer, got x',
        '--max-steps must be a positive integer, got -1',
      ],
    });
  });
});
