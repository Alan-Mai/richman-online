// Money movement: voluntary spending (buy, upgrade) and forced payments (rent, system debts).
import type { PropertyTileDef } from './board';
import type { BankruptcyCause, GameEvent } from './events';
import type { PlayerId, TileIndex } from './ids';
import type { GameState, PlayerState } from './state';
import { playerOf, updatePlayer, type Step } from './update';

/**
 * What the price helpers read. GameState and PlayerView both have it, so the server and the client
 * show the same prices.
 */
export type PriceView = Pick<GameState, 'board' | 'tiles' | 'priceIndex'>;

/** The property at `tile` and its level; anything else is a caller bug. */
function propertyAt(view: PriceView, tile: TileIndex): { def: PropertyTileDef; level: number } {
  const def = view.board.tiles[tile];
  if (def?.kind !== 'property') {
    throw new Error(`tile ${tile} is not a property`);
  }
  return { def, level: view.tiles[tile]?.level ?? 0 };
}

/** What buying the tile costs (docs/GAME_RULES.md §3), buildings included. */
export function buyPrice(view: PriceView, tile: TileIndex): number {
  const { def, level } = propertyAt(view, tile);
  return view.priceIndex * (def.price + level * def.upgradeCost);
}

/** Cost of the next building level on the tile; the same for every level. */
export function upgradeCost(view: PriceView, tile: TileIndex): number {
  return view.priceIndex * propertyAt(view, tile).def.upgradeCost;
}

/** One tile's rent at its own level. */
function levelRent(view: PriceView, tile: TileIndex): number {
  const { def, level } = propertyAt(view, tile);
  const rent = def.rents[level];
  if (rent === undefined) {
    throw new Error(`tile ${tile} has no rent for level ${level}`);
  }
  return rent;
}

/**
 * Rent for stopping on the tile (docs/GAME_RULES.md §3): the rents of every tile on the same street
 * (same name) that the tile's owner has, each at its own level, adjacent or not. An unowned tile
 * counts alone.
 */
export function rentFor(view: PriceView, tile: TileIndex): number {
  const { def } = propertyAt(view, tile);
  const owner = view.tiles[tile]?.owner ?? null;
  let total = 0;
  view.board.tiles.forEach((other, i) => {
    const sameStreet =
      owner !== null &&
      other.kind === 'property' &&
      other.name === def.name &&
      view.tiles[i]?.owner === owner;
    if (i === tile || sameStreet) {
      total += levelRent(view, i);
    }
  });
  return view.priceIndex * total;
}

/**
 * Net worth (docs/GAME_RULES.md §3): cash + deposit + land price and built levels of every owned
 * property, NOT multiplied by the price index. Drives the price index and the original win
 * conditions.
 */
export function netWorth(state: GameState, playerId: PlayerId): number {
  const player = playerOf(state, playerId);
  let total = player.cash + player.deposit;
  state.tiles.forEach((tile, i) => {
    const def = state.board.tiles[i];
    if (tile.owner === playerId && def?.kind === 'property') {
      total += def.price + tile.level * def.upgradeCost;
    }
  });
  return total;
}

/** Money the player may spend voluntarily: buying and upgrading only use cash (§3). */
export function spendable(player: PlayerState): number {
  return player.cash;
}

/** Takes `amount` from cash first, then from the deposit. The caller checks it is covered. */
function withdraw(state: GameState, playerId: PlayerId, amount: number): Step {
  const player = playerOf(state, playerId);
  const fromDeposit = Math.max(0, amount - player.cash);
  const events: GameEvent[] =
    fromDeposit > 0 ? [{ type: 'DepositWithdrawn', playerId, amount: fromDeposit }] : [];
  return {
    state: updatePlayer(state, playerId, (p) => ({
      cash: p.cash - (amount - fromDeposit),
      deposit: p.deposit - fromDeposit,
    })),
    events,
  };
}

/** A forced payment. Rent goes to the tile owner; system debts (taxes, fines) go nowhere. */
export type Debt =
  | { kind: 'rent'; tile: TileIndex; creditor: PlayerId; amount: number }
  | { kind: 'system'; amount: number };

export interface PayResult extends Step {
  bankrupt: boolean;
}

/**
 * Forced payment (docs/GAME_RULES.md §8): cash first, then the deposit. If both together fall short
 * the debtor goes bankrupt: money is zeroed, every owned tile returns to the bank without houses,
 * and a player creditor receives everything the debtor had left. Bankruptcy emits only
 * PlayerBankrupt.
 */
export function pay(state: GameState, debtorId: PlayerId, debt: Debt): PayResult {
  const { amount } = debt;
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new RangeError(`debt must be a non-negative integer, got ${amount}`);
  }
  if (amount === 0) {
    return { state, events: [], bankrupt: false };
  }

  const creditor = debt.kind === 'rent' ? debt.creditor : null;
  const debtor = playerOf(state, debtorId);
  const available = debtor.cash + debtor.deposit;
  if (available >= amount) {
    const paid = withdraw(state, debtorId, amount);
    return {
      state: creditor === null ? paid.state : receive(paid.state, creditor, amount),
      events: paid.events,
      bankrupt: false,
    };
  }

  const paidToCreditor = creditor === null ? 0 : available;
  const releasedTiles = state.tiles.flatMap((tile, i) => (tile.owner === debtorId ? [i] : []));
  let next: GameState = {
    ...updatePlayer(state, debtorId, () => ({ cash: 0, deposit: 0, bankrupt: true })),
    tiles: state.tiles.map((tile) => (tile.owner === debtorId ? { owner: null, level: 0 } : tile)),
  };
  if (creditor !== null) {
    next = receive(next, creditor, paidToCreditor);
  }
  const cause: BankruptcyCause =
    debt.kind === 'rent'
      ? { kind: 'rent', tile: debt.tile, amountDue: amount }
      : { kind: 'system', amountDue: amount };
  return {
    state: next,
    events: [
      {
        type: 'PlayerBankrupt',
        playerId: debtorId,
        creditor,
        paidToCreditor,
        releasedTiles,
        cause,
      },
    ],
    bankrupt: true,
  };
}

/** A creditor is paid into their deposit, not their cash (docs/GAME_RULES.md §3, §8). */
function receive(state: GameState, playerId: PlayerId, amount: number): GameState {
  return updatePlayer(state, playerId, (p) => ({ deposit: p.deposit + amount }));
}

/** Voluntary payment to the bank (buying, upgrading); must be within spendable(). */
export function spend(state: GameState, playerId: PlayerId, amount: number): Step {
  if (amount > spendable(playerOf(state, playerId))) {
    throw new Error(`${playerId} cannot spend ${amount}`);
  }
  return withdraw(state, playerId, amount);
}
