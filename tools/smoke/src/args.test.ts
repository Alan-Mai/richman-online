import { describe, expect, it } from 'vitest';
import { parseArgs } from './args';

const ROOT = process.platform === 'win32' ? 'C:\\work\\repo' : '/work/repo';
const OUTSIDE = process.platform === 'win32' ? 'C:\\tmp\\shots' : '/tmp/shots';
const INSIDE = process.platform === 'win32' ? 'C:\\work\\repo\\out' : '/work/repo/out';
const SIBLING = process.platform === 'win32' ? 'C:\\work\\repo-shots' : '/work/repo-shots';

describe('parseArgs', () => {
  it('accepts an absolute directory outside the repository', () => {
    expect(parseArgs(['--', '--out', OUTSIDE, '--seconds', '3'], ROOT)).toEqual({
      ok: true,
      args: { out: OUTSIDE, seconds: 3 },
    });
  });

  it('defaults to 8 seconds', () => {
    const result = parseArgs(['--out', SIBLING], ROOT);
    expect(result.ok && result.args.seconds).toBe(8);
  });

  it.each([
    [[], '--out is required'],
    [['--out', 'shots'], '--out must be an absolute path'],
    [['--out', INSIDE], '--out must be outside the repository'],
    [['--out', ROOT], '--out must be outside the repository'],
    [['--out'], '--out needs a value'],
    [['--out', OUTSIDE, '--seconds', '0'], '--seconds must be an integer from 1 to 120'],
    [['--out', OUTSIDE, '--seconds', '2.5'], '--seconds must be an integer from 1 to 120'],
    [['--out', OUTSIDE, '--headed'], 'unknown argument: --headed'],
  ])('rejects %j', (argv, error) => {
    expect(parseArgs(argv, ROOT)).toEqual({ ok: false, error });
  });
});
