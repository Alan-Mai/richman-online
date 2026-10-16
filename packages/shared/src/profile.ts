// Character profiles: the money habits of a computer player's character (docs/GAME_RULES.md §1,
// §4). The original takes them from its character template; the caller picks one per computer seat
// (from the player's tables.json, or the provisional profile below) and puts it in the GameSetup.
import { createRng, nextInt } from './rng';
import type { OriginalTables } from './tables';

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

/**
 * One profile per character of the player's tables.json, in its order.
 *
 * For callers building a GameSetup before the game starts (client setup, simulator); the engine
 * never reads tables and applyAction never calls this.
 */
export function profilesFromTables(tables: OriginalTables): CharacterProfile[] {
  return tables.characters.map(({ cashPercent, loanPercent }) => ({ cashPercent, loanPercent }));
}

/**
 * Which characters the computer seats of a game get, as indices into the player's character list:
 * `count` different ones drawn uniformly without replacement, like the original's "add a computer",
 * which only picks characters no seat has (docs/GAME_RULES.md §1). Drawn from the game's seed (not
 * the game's RNG, so the game itself is unaffected), so every caller picks the same.
 *
 * For callers building a GameSetup before the game starts (client setup, simulator); the chosen
 * profiles go into the setup, and applyAction never calls this.
 */
export function drawCharacters(characterCount: number, count: number, gameSeed: number): number[] {
  if (!Number.isInteger(count) || count < 0 || count > characterCount) {
    throw new RangeError(`cannot draw ${count} of ${characterCount} characters`);
  }
  const left = Array.from({ length: characterCount }, (_, i) => i);
  const drawn: number[] = [];
  let rng = createRng((gameSeed ^ 0xc4a2) >>> 0);
  for (let i = 0; i < count; i++) {
    const [index, next] = nextInt(rng, left.length);
    rng = next;
    drawn.push(...left.splice(index, 1));
  }
  return drawn;
}

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
