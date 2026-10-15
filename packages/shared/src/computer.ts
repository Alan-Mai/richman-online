// Computer players' decisions (docs/GAME_RULES.md §8 for auctions). Randomness is drawn by the
// engine when a decision opens and kept in hidden state, so the choice itself is a pure function.
import type { Action } from './actions';
import type { PlayerId, TileIndex } from './ids';
import { previewPath } from './movement';
import { nextInt, type RngState } from './rng';
import type { AuctionPhase, GameState } from './state';
import { at, playerOf } from './update';

/**
 * The original draws each random factor from a 15-bit random number; the engine draws the same
 * steps from its own RNG.
 */
const RANDOM_STEPS = 32768;

/** low..high, both ends included. */
function closedFactor([low, high]: readonly [number, number], r: number): number {
  return low + ((high - low) * r) / (RANDOM_STEPS - 1);
}

/** low..high, high excluded. */
function halfOpenFactor([low, high]: readonly [number, number], r: number): number {
  return low + ((high - low) * r) / RANDOM_STEPS;
}

/**
 * Draws the limit of every computer among `bidders` for the auction of `tile` opening at
 * `startPrice`, in seat order (docs/GAME_RULES.md §8): the least of their cash and
 * - floor((level ÷ 2 + 1 + their properties on the same street) × start price × price index ×
 *   (unownedBase − unownedSlope × unowned share of all properties) × streetFactor); the start
 *   price already includes the price index, so it counts twice, as in the original;
 * - floor(land price × price index × landFactor).
 * Like the original, the factors and the unowned share are single-precision floats.
 */
export function drawComputerLimits(
  state: GameState,
  tile: TileIndex,
  startPrice: number,
  bidders: readonly PlayerId[],
): { limits: Record<PlayerId, number>; rng: RngState } {
  const { config, board, tiles, priceIndex } = state;
  const def = at(board.tiles, tile);
  if (def.kind !== 'property') {
    throw new Error(`tile ${tile} is not a property`);
  }
  const { streetFactor, landFactor, unownedBase, unownedSlope } = config.computerBid;
  const properties = board.tiles.flatMap((t, i) => (t.kind === 'property' ? [i] : []));
  const unowned = properties.filter((i) => at(tiles, i).owner === null).length;
  const unownedFactor = Math.fround(unownedBase - (unownedSlope * unowned) / properties.length);
  const halfLevel = Math.floor(at(tiles, tile).level / 2);

  const limits: Record<PlayerId, number> = {};
  let rng = state.rngState;
  for (const id of bidders) {
    const player = playerOf(state, id);
    if (player.controller !== 'computer') continue;
    const [r1, afterFirst] = nextInt(rng, RANDOM_STEPS);
    const [r2, afterSecond] = nextInt(afterFirst, RANDOM_STEPS);
    rng = afterSecond;
    const sameStreet = properties.filter((i) => {
      const other = at(board.tiles, i);
      return other.kind === 'property' && other.name === def.name && at(tiles, i).owner === id;
    }).length;
    const weight = (halfLevel + 1 + sameStreet) * startPrice * priceIndex;
    const byStreet = Math.floor(
      weight * unownedFactor * Math.fround(closedFactor(streetFactor, r1)),
    );
    const byLand = Math.floor(Math.fround(def.price * priceIndex) * halfOpenFactor(landFactor, r2));
    limits[id] = Math.min(byStreet, byLand, player.cash);
  }
  return { limits, rng };
}

/**
 * The computer bidder's move (docs/GAME_RULES.md §8): the largest raise that keeps the price within
 * its limit, or pass the round if even the smallest one does not. If the leader's cash plus
 * leaderCashMargin falls short of the new price, the raise drops to the smallest one (but the
 * largest) that covers the gap d = leader's cash + margin − price. Only the smallest raise is used
 * when it was the only bidder as the auction opened.
 */
export function computerBid(state: GameState, phase: AuctionPhase): Action {
  const playerId = phase.bidder;
  const raises = state.config.auctionRaises;
  const limit = phase.computerLimits[playerId] ?? 0;
  const fitting = raises.filter((raise) => phase.price + raise <= limit);
  let raise = fitting.at(-1);
  if (raise === undefined) {
    return { type: 'passRound', playerId };
  }
  if (phase.leader !== null) {
    const reach = playerOf(state, phase.leader).cash + state.config.computerBid.leaderCashMargin;
    if (reach < phase.price + raise) {
      const gap = reach - phase.price;
      raise = raises.slice(0, -1).find((step) => gap <= step) ?? raise;
    }
  }
  if (phase.bidders.length === 1) {
    raise = at(raises, 0);
  }
  return { type: 'bid', playerId, raise };
}

/**
 * The dice count a computer on a motorbike or car rolls this turn (docs/GAME_RULES.md §9), from a
 * preview of its next steps; null on foot.
 */
export function drawComputerDiceCount(
  state: GameState,
  playerId: PlayerId,
): { count: number; rng: RngState } | null {
  const { config, board, tiles } = state;
  const player = playerOf(state, playerId);
  if (player.vehicle === 'walk' || player.location.kind !== 'onBoard') {
    return null;
  }
  const most = config.vehicleMaxDice[player.vehicle];
  const rules = config.computerDice;
  const { tile, prev } = player.location;
  // Every visit counts: a preview that turns back at a dead end sees a tile twice. Large buildings
  // will count too once the engine has them (ROADMAP).
  const preview = previewPath(board, tile, prev, rules.previewSteps, state.rngState);
  let good = 0;
  let bad = 0;
  for (const index of preview.path) {
    if (at(board.tiles, index).kind !== 'property') continue;
    const { owner } = at(tiles, index);
    if (owner === null || owner === playerId) good++;
    else bad++;
  }

  if (good === 0 && bad >= rules.crowdedBadTiles) {
    const low = Math.min(rules.crowdedMinDice, most);
    const drawn = pickBetween(low, most, preview.rng);
    return { count: drawn.value, rng: drawn.rng };
  }
  if (good >= rules.clearGoodTiles && bad <= rules.clearBadTiles) {
    return { count: 1, rng: preview.rng };
  }
  return { count: most, rng: preview.rng };
}

/** low..high, both included; no draw when they are equal (an engine detail, as at forks). */
function pickBetween(low: number, high: number, rng: RngState): { value: number; rng: RngState } {
  if (low === high) {
    return { value: low, rng };
  }
  const [offset, next] = nextInt(rng, high - low + 1);
  return { value: low + offset, rng: next };
}
