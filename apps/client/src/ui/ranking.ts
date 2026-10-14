// Final ranking of a last-standing game in the result dialog (docs/GAME_RULES.md §1, ⚙️ not from
// the original game, which shows no ranking at all).
import type { PlayerId } from '@richman/shared';

export interface RankedPlayer {
  id: PlayerId;
  /** 1-based; tied players share a rank and the next rank skips (1, 1, 3). */
  rank: number;
  bankrupt: boolean;
}

/**
 * Survivors first; bankrupt players by when they went bankrupt, latest first.
 * `bankruptcies` lists the players who went bankrupt in each action, in order; players in the
 * same action tie. Players are listed in seat order within a tie.
 */
export function rankPlayers(
  seats: readonly PlayerId[],
  bankruptcies: readonly (readonly PlayerId[])[],
): RankedPlayer[] {
  const bankruptAt = new Map<PlayerId, number>();
  bankruptcies.forEach((group, i) => group.forEach((id) => bankruptAt.set(id, i)));
  // Higher score ranks first.
  const score = (id: PlayerId) => {
    const at = bankruptAt.get(id);
    return at === undefined ? Infinity : at;
  };

  const scored = seats.map((id, seat) => ({ id, seat, score: score(id) }));
  scored.sort((a, b) => (a.score === b.score ? a.seat - b.seat : b.score - a.score));
  return scored.map(({ id, score: s }) => ({
    id,
    rank: scored.filter((other) => other.score > s).length + 1,
    bankrupt: bankruptAt.has(id),
  }));
}
