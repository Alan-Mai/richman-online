// New-game form: turns what the players typed into a GameSetup, or a list of problems.
import {
  DEFAULT_RULE_CONFIG,
  ORIGINAL_SETUP_DEFAULT_TIERS,
  PROVISIONAL_COMPUTER_PROFILE,
  drawCharacters,
  TEST_BRANCH_BOARD,
  TEST_LOOP_BOARD,
  type Board,
  type CharacterProfile,
  type Controller,
  type GameSetup,
  type OriginalTables,
  type PlayerId,
  type PlayerSetup,
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
  /**
   * Option indices (0-5) into the imported tables' setup options; used instead of the three
   * custom fields above while tables.json is imported, and kept apart from them.
   */
  tiers: SetupTiers;
}

export interface SetupTiers {
  startingFunds: number;
  dayLimit: number;
  netWorthTarget: number;
}

export type SetupOptions = OriginalTables['setupOptions'];

/** What the original setup screen shows for each option (docs/GAME_RULES.md §1). */
export interface TierLabels {
  startingFunds: string[];
  dayLimit: string[];
  netWorthTarget: string[];
}

/** The option value at `tier`; an index outside the six options is a caller bug. */
function optionAt(values: readonly number[], tier: number): number {
  const value = Number.isInteger(tier) ? values[tier] : undefined;
  if (value === undefined) throw new Error(`setup option index ${tier} out of range`);
  return value;
}

/** A raw option value of 0 means no limit, whichever option holds it (as the original checks). */
const limitOf = (raw: number): number | null => (raw === 0 ? null : raw);

/**
 * Starting funds and target amounts are plain decimal numbers; the target shows the chosen funds
 * times its multiple; the day limit shows the imported text for each option.
 */
export function tierLabels(options: SetupOptions, startingFundsTier: number): TierLabels {
  const funds = optionAt(options.startingFunds, startingFundsTier);
  return {
    startingFunds: options.startingFunds.map(String),
    dayLimit: [...options.dayLimitLabels],
    netWorthTarget: options.netWorthTargetMultiple.map((m) =>
      m === 0 ? t('setup.tier.noTarget') : String(funds * m),
    ),
  };
}

function tieredSettings(options: SetupOptions, tiers: SetupTiers) {
  return {
    startingFunds: optionAt(options.startingFunds, tiers.startingFunds),
    dayLimit: limitOf(optionAt(options.dayLimit, tiers.dayLimit)),
    netWorthTargetMultiple: limitOf(optionAt(options.netWorthTargetMultiple, tiers.netWorthTarget)),
  };
}

export type SetupError =
  | { field: 'name'; seat: number; reason: 'duplicate' }
  | { field: 'dayLimit' | 'netWorthTarget' | 'startingFunds' | 'seed'; reason: 'invalid' };

export type BuildSetupResult =
  | {
      ok: true;
      setup: GameSetup;
      /** Character numbers (from 1) drawn for the computer seats, by player; empty without tables. */
      characters: Readonly<Record<PlayerId, number>>;
    }
  | { ok: false; errors: SetupError[] };

/** The seats, in order, that the form gives to computers among the first playerCount. */
function computerSeats(form: SetupForm, count: number): number[] {
  return Array.from({ length: count }, (_, seat) => seat).filter(
    (seat) => form.controllers[seat] === 'computer',
  );
}

/**
 * The character numbers (from 1) the computer seats would get with the seed typed in the form,
 * seat by seat (null for humans); null when the seed is blank (drawn at start) or invalid.
 */
export function previewCharacters(
  form: SetupForm,
  characterCount: number,
): (number | null)[] | null {
  if (form.seed.trim() === '') return null;
  const seed = parseWhole(form.seed, 0, UINT32_MAX);
  const count = Math.min(DEFAULT_RULE_CONFIG.maxPlayers, form.playerCount);
  const seats = computerSeats(form, count);
  if (seed === null || seats.length > characterCount) return null;
  const drawn = drawCharacters(characterCount, seats.length, seed);
  return Array.from({ length: count }, (_, seat) => {
    const index = drawn[seats.indexOf(seat)];
    return index === undefined ? null : index + 1;
  });
}

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
    tiers: { ...ORIGINAL_SETUP_DEFAULT_TIERS },
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

/** The three settings typed into the custom fields (non-original input ranges). */
function customSettings(form: SetupForm, errors: SetupError[]) {
  const dayLimit = parseOptional(form.dayLimit, 9999);
  if (dayLimit === undefined) errors.push({ field: 'dayLimit', reason: 'invalid' });
  const netWorthTargetMultiple = parseOptional(form.netWorthTarget, 999);
  if (netWorthTargetMultiple === undefined) {
    errors.push({ field: 'netWorthTarget', reason: 'invalid' });
  }
  const startingFunds = parseWhole(form.startingFunds, 1, 1_000_000_000);
  if (startingFunds === null) errors.push({ field: 'startingFunds', reason: 'invalid' });
  return { dayLimit, netWorthTargetMultiple, startingFunds };
}

export function randomSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0]!;
}

/**
 * Blank names fall back to the default "玩家 n"; names are trimmed and cut to the limit. Computer
 * seats get different characters from `characters` (the imported tables.json) drawn by the seed,
 * or the provisional profile without it. With the imported setup options, starting funds, day
 * limit and net worth target come from the chosen options and the custom fields are ignored.
 */
export function buildSetup(
  form: SetupForm,
  makeSeed: () => number = randomSeed,
  characters: readonly CharacterProfile[] | null = null,
  setupOptions: SetupOptions | null = null,
): BuildSetupResult {
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

  const { dayLimit, netWorthTargetMultiple, startingFunds } =
    setupOptions === null ? customSettings(form, errors) : tieredSettings(setupOptions, form.tiers);
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
  const seats = computerSeats(form, count);
  const drawn =
    characters === null || seats.length > characters.length
      ? null
      : drawCharacters(characters.length, seats.length, seed);
  const characterOf = (seat: number): number | undefined => drawn?.[seats.indexOf(seat)];
  return {
    ok: true,
    characters: Object.fromEntries(
      names.flatMap((_, seat) => {
        const index = characterOf(seat);
        return index === undefined ? [] : [[`p${seat + 1}`, index + 1]];
      }),
    ),
    setup: {
      config: {
        ...DEFAULT_RULE_CONFIG,
        startingVehicle: form.vehicle,
        dayLimit,
        netWorthTargetMultiple,
        startingFunds,
      },
      board: BOARDS[form.board],
      players: names.map((name, seat): PlayerSetup => {
        const id = `p${seat + 1}`;
        if (form.controllers[seat] !== 'computer') return { id, name, controller: 'human' };
        const index = characterOf(seat);
        const drawnProfile = index === undefined ? undefined : characters?.[index];
        return {
          id,
          name,
          controller: 'computer',
          profile: drawnProfile ?? PROVISIONAL_COMPUTER_PROFILE,
        };
      }),
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
