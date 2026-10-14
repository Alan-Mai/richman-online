// Command-line parsing for the simulator. A small hand-written parser: node:util parseArgs refuses
// values that start with "-", which hides the clearer range errors below.
import { BOARD_NAMES, isBoardName, type BoardName } from './game';

export interface RunOptions {
  board: BoardName;
  games: number;
  seed: number;
  /** null: no day limit (the default). */
  dayLimit: number | null;
  /** null: no net worth target (the default). */
  netWorthTargetMultiple: number | null;
  /** Simulator-only safety cap in days; see GameSpec.maxDays. */
  maxDays: number;
  maxSteps: number;
  maxFailureDetails: number;
}

export type Command = { kind: 'run'; options: RunOptions } | { kind: 'replay'; file: string };

export type ParseResult = { ok: true; command: Command } | { ok: false; errors: string[] };

export const USAGE = `usage:
  pnpm -F sim sim -- [--games 1000] [--seed 1] [--board test-loop|test-branch]
                     [--day-limit N] [--net-worth-target MULTIPLE] [--max-days 1000]
                     [--max-steps 20 x max-days] [--max-failure-details 5]
  pnpm -F sim sim -- replay <failure.json>`;

const OPTION_NAMES = [
  'board',
  'games',
  'seed',
  'day-limit',
  'net-worth-target',
  'max-days',
  'max-steps',
  'max-failure-details',
] as const;
type OptionName = (typeof OPTION_NAMES)[number];

const UINT32_MAX = 0xffff_ffff;

function isOptionName(name: string): name is OptionName {
  return (OPTION_NAMES as readonly string[]).includes(name);
}

export function parseCommand(argv: readonly string[]): ParseResult {
  const errors: string[] = [];
  const values = new Map<OptionName, string>();
  const positionals: string[] = [];

  const rest = argv[0] === '--' ? argv.slice(1) : [...argv];
  for (let token = rest.shift(); token !== undefined; token = rest.shift()) {
    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }
    const eq = token.indexOf('=');
    const name = eq === -1 ? token.slice(2) : token.slice(2, eq);
    if (!isOptionName(name)) {
      errors.push(`unknown option --${name}`);
      continue;
    }
    const value = eq === -1 ? rest.shift() : token.slice(eq + 1);
    if (value === undefined) {
      errors.push(`--${name} needs a value`);
      continue;
    }
    values.set(name, value);
  }

  const [command, ...files] = positionals;
  if (command === 'replay') {
    const [file] = files;
    if (files.length !== 1 || file === undefined) {
      errors.push('replay needs exactly one file');
    }
    for (const name of values.keys()) {
      errors.push(`replay takes no options, got --${name}`);
    }
    return errors.length > 0 || file === undefined
      ? { ok: false, errors }
      : { ok: true, command: { kind: 'replay', file } };
  }
  if (command !== undefined) {
    errors.push(`unknown command ${command}`);
  }

  const readInt = (name: OptionName, fallback: number, min: number, max: number): number => {
    const raw = values.get(name);
    if (raw === undefined) {
      return fallback;
    }
    const value = /^-?\d+$/.test(raw) ? Number(raw) : NaN;
    if (Number.isSafeInteger(value) && value >= min && value <= max) {
      return value;
    }
    const expected =
      max === UINT32_MAX
        ? `an integer in ${min}..${max}`
        : min === 0
          ? 'a non-negative integer'
          : 'a positive integer';
    errors.push(`--${name} must be ${expected}, got ${raw}`);
    return fallback;
  };

  const games = readInt('games', 1000, 1, Number.MAX_SAFE_INTEGER);
  const seed = readInt('seed', 1, 0, UINT32_MAX);

  const boardRaw = values.get('board') ?? 'test-loop';
  const board: BoardName = isBoardName(boardRaw) ? boardRaw : 'test-loop';
  if (!isBoardName(boardRaw)) {
    errors.push(`--board must be ${BOARD_NAMES.join(' or ')}, got ${boardRaw}`);
  }

  const optionalPositive = (name: OptionName): number | null =>
    values.has(name) ? readInt(name, 1, 1, Number.MAX_SAFE_INTEGER) : null;
  const dayLimit = optionalPositive('day-limit');
  const netWorthTargetMultiple = optionalPositive('net-worth-target');
  const maxDays = readInt('max-days', 1000, 1, Number.MAX_SAFE_INTEGER);
  if (dayLimit !== null && dayLimit > maxDays) {
    errors.push(`--day-limit ${dayLimit} exceeds --max-days ${maxDays}`);
  }
  // At most two actions per turn, so 20 per day leaves room for up to ten players.
  const maxSteps = readInt('max-steps', maxDays * 20, 1, Number.MAX_SAFE_INTEGER);
  const maxFailureDetails = readInt('max-failure-details', 5, 0, Number.MAX_SAFE_INTEGER);

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    command: {
      kind: 'run',
      options: {
        board,
        games,
        seed,
        dayLimit,
        netWorthTargetMultiple,
        maxDays,
        maxSteps,
        maxFailureDetails,
      },
    },
  };
}
