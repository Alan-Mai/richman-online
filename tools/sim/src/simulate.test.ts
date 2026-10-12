import { describe, expect, it } from 'vitest';
import type { RunOptions } from './args';
import { ENGINE, type Engine } from './game';
import { runCommand, type SimIO } from './simulate';

function fakeIO() {
  const output: string[] = [];
  const files = new Map<string, string>();
  const io: SimIO = {
    print: (text) => output.push(text),
    writeLog: (name, text) => {
      files.set(`out/${name}`, text);
      return `out/${name}`;
    },
    readFile: (path) => {
      const text = files.get(path);
      if (text === undefined) throw new Error(`ENOENT: ${path}`);
      return text;
    },
    now: () => 0,
  };
  return { io, files, text: () => output.join('\n') };
}

const OPTIONS: RunOptions = {
  games: 20,
  seed: 1,
  win: 'richestAtRoundLimit',
  maxRounds: 100,
  maxSteps: 10_000,
  maxFailureDetails: 5,
};

/** Every game fails once round 2 starts. */
const BROKEN: Engine = {
  ...ENGINE,
  checkInvariants: (state) => (state.turn.round >= 2 ? ['turn: broken'] : []),
};

describe('runCommand run', () => {
  it('plays clean games without writing files', () => {
    const { io, files, text } = fakeIO();
    expect(runCommand({ kind: 'run', options: OPTIONS }, io)).toBe(0);
    expect(text()).toContain('games: 20 (finished 20, unfinished 0, failed 0)');
    expect(files.size).toBe(0);
  });

  it('counts lastStanding games cut off by the step limit', () => {
    const { io, text } = fakeIO();
    const options: RunOptions = { ...OPTIONS, games: 3, win: 'lastStanding', maxRounds: null };
    expect(runCommand({ kind: 'run', options: { ...options, maxSteps: 5 } }, io)).toBe(0);
    expect(text()).toContain('games: 3 (finished 0, unfinished 3, failed 0)');
  });

  it('details only the first failures, logs all of them and groups the reasons', () => {
    const { io, files, text } = fakeIO();
    const options = { ...OPTIONS, games: 8, seed: 40, maxFailureDetails: 2 };
    expect(runCommand({ kind: 'run', options }, io, BROKEN)).toBe(1);

    const output = text();
    expect(output.match(/^FAIL /gm)).toHaveLength(2);
    expect(output).toContain('FAIL game #0 (run seed 40), game seed 40');
    expect(output).toContain('FAIL game #1 (run seed 40), game seed 41');
    expect(output).toContain('6 more failures written to out/ without details');
    expect(output).toContain('8x invariant: turn: broken (e.g. game seed 40)');
    expect([...files.keys()]).toEqual(
      Array.from({ length: 8 }, (_, i) => `out/failure-${40 + i}.json`),
    );
  });

  it('replays a written failure log and confirms it reproduces', () => {
    const { io, text } = fakeIO();
    runCommand({ kind: 'run', options: { ...OPTIONS, games: 1, seed: 9 } }, io, BROKEN);
    expect(runCommand({ kind: 'replay', file: 'out/failure-9.json' }, io, BROKEN)).toBe(1);
    expect(text()).toContain('reproduced: yes');
  });

  it('reports a replay that no longer fails', () => {
    const { io, text } = fakeIO();
    runCommand({ kind: 'run', options: { ...OPTIONS, games: 1, seed: 9 } }, io, BROKEN);
    expect(runCommand({ kind: 'replay', file: 'out/failure-9.json' }, io)).toBe(0);
    expect(text()).toContain('reproduced: no');
  });

  it('rejects an unreadable or malformed log', () => {
    const { io, files, text } = fakeIO();
    expect(runCommand({ kind: 'replay', file: 'out/missing.json' }, io)).toBe(2);
    expect(text()).toContain('cannot read out/missing.json');
    files.set('out/bad.json', '{');
    expect(runCommand({ kind: 'replay', file: 'out/bad.json' }, io)).toBe(2);
    expect(text()).toContain('not valid JSON');
  });
});
