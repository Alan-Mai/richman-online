// Character profiles: the money habits of a computer player's character (docs/GAME_RULES.md §1,
// §4). The original takes them from its character template; the caller picks one per computer seat
// (from the player's tables.json, or the provisional profile below) and puts it in the GameSetup.

/**
 * The share of cash + deposit a computer keeps as cash, and the share of net worth it borrows.
 * Whole percents 0..100.
 */
export interface CharacterProfile {
  cashPercent: number;
  loanPercent: number;
}

/**
 * For computer seats when no tables.json is imported: half cash, borrowing half of net worth.
 * Chosen for this project, not the original's.
 */
export const PROVISIONAL_COMPUTER_PROFILE: CharacterProfile = { cashPercent: 50, loanPercent: 50 };

/** Whether both percents are whole numbers 0..100. */
export function isValidProfile(profile: unknown): profile is CharacterProfile {
  if (typeof profile !== 'object' || profile === null) {
    return false;
  }
  const { cashPercent, loanPercent } = profile as Record<string, unknown>;
  return isPercent(cashPercent) && isPercent(loanPercent);
}

function isPercent(value: unknown): boolean {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 100;
}

/**
 * A computer's opening cash and deposit (docs/GAME_RULES.md §1): cash = trunc(cashPercent ×
 * (funds ÷ 100)) in double precision, the rest as deposit.
 */
export function openingSplit(
  funds: number,
  profile: CharacterProfile,
): { cash: number; deposit: number } {
  const cash = Math.trunc(profile.cashPercent * (funds / 100));
  return { cash, deposit: funds - cash };
}
