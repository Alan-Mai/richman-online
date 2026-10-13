// New-game form: turns what the players typed into a GameSetup, or a list of problems.
import {
  DEFAULT_RULE_CONFIG,
  TEST_LOOP_BOARD,
  type GameSetup,
  type WinCondition,
} from '@richman/shared';
import { t } from '../i18n';

export const NAME_MAX_LENGTH = 12;
const UINT32_MAX = 0xffff_ffff;

/** Raw form values; numbers stay strings until validated. */
export interface SetupForm {
  playerCount: number;
  names: string[];
  winCondition: WinCondition;
  maxRounds: string;
  startingCash: string;
  startingDeposit: string;
  /** Empty means a random seed. */
  seed: string;
}

export type SetupError =
  | { field: 'name'; seat: number; reason: 'duplicate' }
  | { field: 'maxRounds' | 'startingCash' | 'startingDeposit' | 'seed'; reason: 'invalid' };

export type BuildSetupResult = { ok: true; setup: GameSetup } | { ok: false; errors: SetupError[] };

export function defaultSetupForm(): SetupForm {
  return {
    playerCount: DEFAULT_RULE_CONFIG.maxPlayers,
    names: Array.from({ length: DEFAULT_RULE_CONFIG.maxPlayers }, (_, i) =>
      t('setup.defaultName', { n: i + 1 }),
    ),
    winCondition: 'richestAtRoundLimit',
    maxRounds: '20',
    startingCash: String(DEFAULT_RULE_CONFIG.startingCash),
    startingDeposit: String(DEFAULT_RULE_CONFIG.startingDeposit),
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

  const maxRounds =
    form.winCondition === 'richestAtRoundLimit' ? parseWhole(form.maxRounds, 1, 9999) : null;
  if (form.winCondition === 'richestAtRoundLimit' && maxRounds === null) {
    errors.push({ field: 'maxRounds', reason: 'invalid' });
  }
  const startingCash = parseWhole(form.startingCash, 0, 1_000_000_000);
  if (startingCash === null) errors.push({ field: 'startingCash', reason: 'invalid' });
  const startingDeposit = parseWhole(form.startingDeposit, 0, 1_000_000_000);
  if (startingDeposit === null) errors.push({ field: 'startingDeposit', reason: 'invalid' });
  const seed = form.seed.trim() === '' ? makeSeed() : parseWhole(form.seed, 0, UINT32_MAX);
  if (seed === null) errors.push({ field: 'seed', reason: 'invalid' });

  if (errors.length > 0 || startingCash === null || startingDeposit === null || seed === null) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    setup: {
      config: {
        ...DEFAULT_RULE_CONFIG,
        winCondition: form.winCondition,
        maxRounds,
        startingCash,
        startingDeposit,
      },
      board: TEST_LOOP_BOARD,
      players: names.map((name, seat) => ({ id: `p${seat + 1}`, name })),
      seed,
    },
  };
}

export function describeSetupError(error: SetupError, form: SetupForm): string {
  switch (error.field) {
    case 'name':
      return t('setup.error.duplicateName', { name: (form.names[error.seat] ?? '').trim() });
    case 'maxRounds':
      return t('setup.error.maxRounds');
    case 'startingCash':
      return t('setup.error.money', { field: t('setup.startingCash') });
    case 'startingDeposit':
      return t('setup.error.money', { field: t('setup.startingDeposit') });
    case 'seed':
      return t('setup.error.seed');
  }
}
