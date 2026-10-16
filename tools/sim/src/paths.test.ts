import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseCommand, type Command } from './args';
import { invocationDir, withResolvedTables } from './paths';

const ROOT = resolve('/repo');
const SIM = join(ROOT, 'tools', 'sim');

function parsed(args: string[]): Command {
  const result = parseCommand(args);
  expect(result.ok).toBe(true);
  if (!result.ok) return { kind: 'replay', file: '' };
  return result.command;
}

function tablesOf(command: Command): string | null {
  expect(command.kind).toBe('run');
  return command.kind === 'run' ? command.options.tables : null;
}

describe('invocationDir', () => {
  it('is INIT_CWD, where pnpm was called', () => {
    expect(invocationDir({ INIT_CWD: ROOT }, SIM)).toBe(ROOT);
  });

  it('falls back to the working directory without INIT_CWD', () => {
    expect(invocationDir({}, SIM)).toBe(SIM);
    expect(invocationDir({ INIT_CWD: '' }, SIM)).toBe(SIM);
  });
});

describe('withResolvedTables', () => {
  it('resolves a relative --tables against the directory', () => {
    const command = parsed(['--tables', 'local-assets/tables.json']);
    expect(tablesOf(withResolvedTables(command, ROOT))).toBe(
      join(ROOT, 'local-assets', 'tables.json'),
    );
  });

  it('keeps an absolute --tables', () => {
    const absolute = join(ROOT, 'elsewhere', 'tables.json');
    const command = parsed(['--tables', absolute]);
    expect(tablesOf(withResolvedTables(command, SIM))).toBe(absolute);
  });

  it('leaves runs without --tables and replays alone', () => {
    const run = parsed([]);
    expect(withResolvedTables(run, ROOT)).toEqual(run);
    const replay = parsed(['replay', 'out/failure-1.json']);
    expect(withResolvedTables(replay, ROOT)).toEqual(replay);
  });
});
