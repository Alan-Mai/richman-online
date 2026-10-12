import { describe, expect, it } from 'vitest';
import { parseCommand, type RunOptions } from './args';

const DEFAULTS: RunOptions = {
  games: 1000,
  seed: 1,
  win: 'richestAtRoundLimit',
  maxRounds: 100,
  maxSteps: 10_000,
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
      '--seed',
      '4294967295',
      '--max-rounds',
      '7',
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
          games: 20,
          seed: 4294967295,
          win: 'richestAtRoundLimit',
          maxRounds: 7,
          maxSteps: 50,
          maxFailureDetails: 0,
        },
      },
    });
  });

  it('runs lastStanding without a round limit', () => {
    expect(parseCommand(['--win', 'lastStanding'])).toEqual({
      ok: true,
      command: { kind: 'run', options: { ...DEFAULTS, win: 'lastStanding', maxRounds: null } },
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
      'unknown win condition',
      ['--win', 'richest'],
      '--win must be richestAtRoundLimit or lastStanding, got richest',
    ],
    [
      'a round limit with lastStanding',
      ['--win', 'lastStanding', '--max-rounds', '50'],
      '--max-rounds cannot be used with --win lastStanding',
    ],
    ['zero max-rounds', ['--max-rounds', '0'], '--max-rounds must be a positive integer, got 0'],
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
