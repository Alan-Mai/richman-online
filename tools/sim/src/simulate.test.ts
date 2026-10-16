import { ORIGINAL_TABLES_VERSION } from '@richman/shared';
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
  board: 'test-loop',
  controllers: 'random',
  vehicle: 'walk',
  games: 20,
  seed: 1,
  dayLimit: 100,
  netWorthTargetMultiple: null,
  maxDays: 1000,
  maxSteps: 20_000,
  maxFailureDetails: 5,
  tables: null,
};

/** Every game fails once round 2 starts. */
const BROKEN: Engine = {
  ...ENGINE,
  checkInvariants: (state) => (state.turn.round >= 2 ? ['turn: broken'] : []),
};

/** A tables.json with invented values only. */
function fakeTablesJson(): string {
  return JSON.stringify({
    version: ORIGINAL_TABLES_VERSION,
    generatedAt: '2000-01-01T00:00:00.000Z',
    source: { file: 'fake.exe', size: 1, sha256: '00' },
    animation: {
      frameTicks: [9, 7, 3],
      stepPixels: { walk: 5, motorbike: 6, car: 7, temporary: 5 },
      diceAnimDelay: [11, 12, 13, 0],
    },
    items: Array.from({ length: 13 }, (_, i) => ({
      id: i + 1,
      unknownAt0: 0,
      unknownAt1: 0,
      stock: i,
      points: 20 + i,
    })),
    setupOptions: {
      startingFunds: [111, 222, 333, 444, 555, 666],
      dayLimit: [0, 31, 62, 93, 124, 155],
      netWorthTargetMultiple: [0, 7, 6, 5, 4, 3],
    },
    characters: Array.from({ length: 12 }, (_, i) => ({ id: i, cashPercent: 5 + i * 8 })),
  });
}

describe('runCommand run with --tables', () => {
  it('plays clean games with characters drawn from the file', () => {
    const { io, files, text } = fakeIO();
    files.set('fake/tables.json', fakeTablesJson());
    const options: RunOptions = { ...OPTIONS, controllers: 'computer', tables: 'fake/tables.json' };
    expect(runCommand({ kind: 'run', options }, io)).toBe(0);
    expect(text()).toContain('games: 20 (finished 20, unfinished 0, failed 0)');
    expect(text()).toMatch(/banks per game: .*computer rebalances \d/);
  });

  it('refuses a missing or unusable file before playing', () => {
    const missing = fakeIO();
    const options: RunOptions = { ...OPTIONS, tables: 'fake/tables.json' };
    expect(runCommand({ kind: 'run', options }, missing.io)).toBe(2);
    expect(missing.text()).toContain('cannot read fake/tables.json');

    const unusable = fakeIO();
    unusable.files.set('fake/tables.json', JSON.stringify({ version: 999 }));
    expect(runCommand({ kind: 'run', options }, unusable.io)).toBe(2);
    expect(unusable.text()).toContain('fake/tables.json is not a usable tables.json');
    expect(unusable.text()).not.toContain('games:');
  });
});

describe('runCommand run', () => {
  it('plays clean games without writing files', () => {
    const { io, files, text } = fakeIO();
    expect(runCommand({ kind: 'run', options: OPTIONS }, io)).toBe(0);
    expect(text()).toContain('games: 20 (finished 20, unfinished 0, failed 0)');
    expect(files.size).toBe(0);
  });

  it('counts games cut off by the safety cap on days as unfinished', () => {
    const { io, text } = fakeIO();
    const options: RunOptions = { ...OPTIONS, games: 3, dayLimit: null, maxDays: 2 };
    expect(runCommand({ kind: 'run', options }, io)).toBe(0);
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

  it('exits with 1 when a replay reproduces an engine error', () => {
    const { io, text } = fakeIO();
    const throwing: Engine = {
      ...ENGINE,
      applyAction: (state, action) => {
        if (state.turn.round >= 2) throw new Error('kaboom');
        return ENGINE.applyAction(state, action);
      },
    };
    runCommand({ kind: 'run', options: { ...OPTIONS, games: 1, seed: 9 } }, io, throwing);
    expect(runCommand({ kind: 'replay', file: 'out/failure-9.json' }, io, throwing)).toBe(1);
    expect(text()).toContain('exception: kaboom');
    expect(text()).toContain('reproduced: yes');
  });

  it('exits with 0 when a replay reproduces a step-limit failure', () => {
    const { io, text } = fakeIO();
    runCommand({ kind: 'run', options: { ...OPTIONS, games: 1, seed: 9, maxSteps: 5 } }, io);
    expect(runCommand({ kind: 'replay', file: 'out/failure-9.json' }, io)).toBe(0);
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
