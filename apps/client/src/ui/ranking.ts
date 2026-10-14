// Final ranking shown in the result dialog (docs/GAME_RULES.md §1, ⚙️ not from the original game).
import type { GameEvent, PlayerId } from '@richman/shared';

type GameEnded = Extract<GameEvent, { type: 'GameEnded' }>;

export interface RankedPlayer {
  id: PlayerId;
  /** 1-based; tied players share a rank and the next rank skips (1, 1, 3). */
  rank: number;
  netWorth: number;
  bankrupt: boolean;
}

/**
 * Day limit or net worth target: by net worth, equal amounts by seat (the earlier seat ranks
 * higher, as it wins the tie), so no ranks are shared.
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
  const worth = (id: PlayerId) => ended.netWorth[id] ?? 0;
  const byWorth = ended.reason !== 'lastStanding';

  // Higher score ranks first.
  const score = byWorth
    ? worth
    : (id: PlayerId) => {
        const at = bankruptAt.get(id);
        return at === undefined ? Infinity : at;
      };

  const scored = seats.map((id, seat) => ({ id, seat, score: score(id) }));
  scored.sort((a, b) => (a.score === b.score ? a.seat - b.seat : b.score - a.score));
  return scored.map(({ id, score: s }, index) => ({
    id,
    rank: byWorth ? index + 1 : scored.filter((other) => other.score > s).length + 1,
    netWorth: worth(id),
    bankrupt: bankruptAt.has(id),
  }));
}
