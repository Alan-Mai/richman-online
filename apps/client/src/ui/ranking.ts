// Final ranking shown in the result dialog (docs/GAME_RULES.md §1, ⚙️ not from the original game).
import type { GameEvent, PlayerId } from '@richman/shared';

type GameEnded = Extract<GameEvent, { type: 'GameEnded' }>;

export interface RankedPlayer {
  id: PlayerId;
  /** 1-based; tied players share a rank and the next rank skips (1, 1, 3). */
  rank: number;
  totalAssets: number;
  bankrupt: boolean;
}

/**
 * richestAtRoundLimit (reason 'roundLimit'): by total assets, ties share a rank.
 * lastStanding: survivors first; bankrupt players by when they went bankrupt, latest first.
 * `bankruptcies` lists the players who went bankrupt in each action, in order; players in the
 * same action tie. Players are listed in seat order within a tie.
 */
export function rankPlayers(
  seats: readonly PlayerId[],
  ended: GameEnded,
  bankruptcies: readonly (readonly PlayerId[])[],
): RankedPlayer[] {
  const bankruptAt = new Map<PlayerId, number>();
  bankruptcies.forEach((group, i) => group.forEach((id) => bankruptAt.set(id, i)));
  const total = (id: PlayerId) => ended.totalAssets[id] ?? 0;

  // Higher score ranks first.
  const score =
    ended.reason === 'roundLimit'
      ? total
      : (id: PlayerId) => {
          const at = bankruptAt.get(id);
          return at === undefined ? Infinity : at;
        };

  const scored = seats.map((id, seat) => ({ id, seat, score: score(id) }));
  scored.sort((a, b) => (a.score === b.score ? a.seat - b.seat : b.score - a.score));
  return scored.map(({ id, score: s }) => ({
    id,
    rank: scored.filter((other) => other.score > s).length + 1,
    totalAssets: total(id),
    bankrupt: bankruptAt.has(id),
  }));
}
