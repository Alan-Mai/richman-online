// New-game form: turns what the players typed into a GameSetup, or a list of problems.
import {
  DEFAULT_RULE_CONFIG,
  TEST_BRANCH_BOARD,
  TEST_LOOP_BOARD,
  type Board,
  type Controller,
  type GameSetup,
  type Vehicle,
} from '@richman/shared';
import { t } from '../i18n';

export const NAME_MAX_LENGTH = 12;
const UINT32_MAX = 0xffff_ffff;

/** Built-in boards a local game can be played on, in menu order. */
export const BOARDS = {
  'test-loop': TEST_LOOP_BOARD,
  'test-branch': TEST_BRANCH_BOARD,
} as const satisfies Record<string, Board>;

export type BoardChoice = keyof typeof BOARDS;

export function isBoardChoice(value: string): value is BoardChoice {
  return Object.hasOwn(BOARDS, value);
}

/** Raw form values; numbers stay strings until validated. */
export interface SetupForm {
  board: BoardChoice;
  playerCount: number;
  names: string[];
  /** Who plays each seat; seats past the list are human. */
  controllers: Controller[];
  /** What everyone rides from the start (one setting for all, as in the original). */
  vehicle: Vehicle;
  /** Empty means no day limit. */
  dayLimit: string;
  /** Multiple of the starting funds; empty means no target. */
  netWorthTarget: string;
  startingFunds: string;
  /** Empty means a random seed. */
  seed: string;
}

export type SetupError =
  | { field: 'name'; seat: number; reason: 'duplicate' }
  | { field: 'dayLimit' | 'netWorthTarget' | 'startingFunds' | 'seed'; reason: 'invalid' };

export type BuildSetupResult = { ok: true; setup: GameSetup } | { ok: false; errors: SetupError[] };

export function defaultSetupForm(): SetupForm {
  return {
    board: 'test-loop',
    playerCount: DEFAULT_RULE_CONFIG.maxPlayers,
    names: Array.from({ length: DEFAULT_RULE_CONFIG.maxPlayers }, (_, i) =>
      t('setup.defaultName', { n: i + 1 }),
    ),
    controllers: Array.from({ length: DEFAULT_RULE_CONFIG.maxPlayers }, () => 'human'),
    vehicle: DEFAULT_RULE_CONFIG.startingVehicle,
    dayLimit: '',
    netWorthTarget: '',
    startingFunds: String(DEFAULT_RULE_CONFIG.startingFunds),
    seed: '',
  };
}

/** Parses a whole number written with digits only (optional thousands commas). */
function parseWhole(text: string, min: number, max: number): number | null {
  const cleaned = text.trim().replaceAll(',', '');
  if (!/^\d+$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isSafeInteger(value) && value >= min && value <= max ? value : null;
}

/** Blank is null (no limit); otherwise a whole number in 1..max, or undefined when invalid. */
function parseOptional(text: string, max: number): number | null | undefined {
  if (text.trim() === '') return null;
  return parseWhole(text, 1, max) ?? undefined;
}

export function randomSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0]!;
}

/** Blank names fall back to the default "玩家 n"; names are trimmed and cut to the limit. */
export function buildSetup(form: SetupForm, makeSeed: () => number = randomSeed): BuildSetupResult {
  const errors: SetupError[] = [];
  const count = Math.min(
    DEFAULT_RULE_CONFIG.maxPlayers,
    Math.max(DEFAULT_RULE_CONFIG.minPlayers, form.playerCount),
  );

  const names = Array.from({ length: count }, (_, seat) => {
    const typed = (form.names[seat] ?? '').trim().slice(0, NAME_MAX_LENGTH);
    return typed === '' ? t('setup.defaultName', { n: seat + 1 }) : typed;
  });
  names.forEach((name, seat) => {
    if (names.indexOf(name) !== seat) errors.push({ field: 'name', seat, reason: 'duplicate' });
  });

  const dayLimit = parseOptional(form.dayLimit, 9999);
  if (dayLimit === undefined) errors.push({ field: 'dayLimit', reason: 'invalid' });
  const netWorthTargetMultiple = parseOptional(form.netWorthTarget, 999);
  if (netWorthTargetMultiple === undefined) {
    errors.push({ field: 'netWorthTarget', reason: 'invalid' });
  }
  const startingFunds = parseWhole(form.startingFunds, 1, 1_000_000_000);
  if (startingFunds === null) errors.push({ field: 'startingFunds', reason: 'invalid' });
  const seed = form.seed.trim() === '' ? makeSeed() : parseWhole(form.seed, 0, UINT32_MAX);
  if (seed === null) errors.push({ field: 'seed', reason: 'invalid' });

  if (
    errors.length > 0 ||
    dayLimit === undefined ||
    netWorthTargetMultiple === undefined ||
    startingFunds === null ||
    seed === null
  ) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    setup: {
      config: {
        ...DEFAULT_RULE_CONFIG,
        startingVehicle: form.vehicle,
        dayLimit,
        netWorthTargetMultiple,
        startingFunds,
      },
      board: BOARDS[form.board],
      players: names.map((name, seat) => ({
        id: `p${seat + 1}`,
        name,
        controller: form.controllers[seat] ?? 'human',
      })),
      seed,
    },
  };
}

export function describeSetupError(error: SetupError, form: SetupForm): string {
  switch (error.field) {
    case 'name':
      return t('setup.error.duplicateName', { name: (form.names[error.seat] ?? '').trim() });
    case 'dayLimit':
      return t('setup.error.dayLimit');
    case 'netWorthTarget':
      return t('setup.error.netWorthTarget');
    case 'startingFunds':
      return t('setup.error.startingFunds');
    case 'seed':
      return t('setup.error.seed');
  }
}
