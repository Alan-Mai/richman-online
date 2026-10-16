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

/**
 * Where the bidding on a property starts (docs/GAME_RULES.md §8): floor(land price × (1 + 0.5 ×
 * level)) × price index. Upgrade costs do not count.
 */
export function auctionStartPrice(view: PriceView, tile: TileIndex): number {
  const { def, level } = propertyAt(view, tile);
  // price × (1 + 0.5 × level) in integers, rounded down.
  return view.priceIndex * Math.floor((def.price * (2 + level)) / 2);
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

/** What netWorth reads; GameState, PlayerView and the client's display model all have it. */
export type NetWorthView = Pick<GameState, 'board' | 'tiles'> & {
  players: readonly Pick<PlayerState, 'id' | 'cash' | 'deposit' | 'loan'>[];
};

/**
 * Net worth (docs/GAME_RULES.md §3): cash + deposit + land price and built levels of every owned
 * property, NOT multiplied by the price index, minus the loan. Drives the price index, the original
 * win conditions and how much a player may borrow. Takes a NetWorthView so the client can show it
 * from what is on screen.
 */
export function netWorth(view: NetWorthView, playerId: PlayerId): number {
  const player = view.players.find((p) => p.id === playerId);
  if (player === undefined) {
    throw new Error(`unknown player ${playerId}`);
  }
  let total = player.cash + player.deposit - player.loan;
  view.tiles.forEach((tile, i) => {
    const def = view.board.tiles[i];
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

/**
 * A forced payment. Rent goes to the tile owner; system debts (taxes, fines) go nowhere unless the
 * debtor goes bankrupt over one, when what they had left goes into the lottery pool.
 */
export type Debt =
  | { kind: 'rent'; tile: TileIndex; creditor: PlayerId; amount: number }
  | { kind: 'system'; amount: number }
  /** Paying a loan back, deposit first; at most the loan. */
  | { kind: 'loan'; amount: number };

export interface PayResult extends Step {
  bankrupt: boolean;
  /** The properties a bankruptcy released; empty otherwise. */
  releasedTiles: readonly TileIndex[];
}

/**
 * Forced payment (docs/GAME_RULES.md §8): cash first, then the deposit; a loan repayment the other
 * way round, lowering the loan (the due date is the caller's). If both together fall short the
 * debtor goes bankrupt: money and loan are zeroed, every owned tile becomes unowned and keeps its
 * buildings, and everything the debtor had left goes to a player creditor, into the lottery pool
 * for a debt to the system, or nowhere for a loan. The auctions that may follow are the caller's.
 * A loan repayment emits nothing (its caller says why it was paid); bankruptcy emits only
 * PlayerBankrupt.
 */
export function pay(state: GameState, debtorId: PlayerId, debt: Debt): PayResult {
  const { amount } = debt;
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new RangeError(`debt must be a non-negative integer, got ${amount}`);
  }
  const debtor = playerOf(state, debtorId);
  if (debt.kind === 'loan' && amount > debtor.loan) {
    throw new RangeError(`${debtorId} owes ${debtor.loan}, not ${amount}`);
  }
  if (amount === 0) {
    return { state, events: [], bankrupt: false, releasedTiles: [] };
  }

  const creditor = debt.kind === 'rent' ? debt.creditor : null;
  const available = debtor.cash + debtor.deposit;
  if (available >= amount && debt.kind === 'loan') {
    const fromDeposit = Math.min(debtor.deposit, amount);
    return {
      state: updatePlayer(state, debtorId, (p) => ({
        deposit: p.deposit - fromDeposit,
        cash: p.cash - (amount - fromDeposit),
        loan: p.loan - amount,
      })),
      events: [],
      bankrupt: false,
      releasedTiles: [],
    };
  }
  if (available >= amount) {
    const paid = withdraw(state, debtorId, amount);
    return {
      state: creditor === null ? paid.state : receive(paid.state, creditor, amount),
      events: paid.events,
      bankrupt: false,
      releasedTiles: [],
    };
  }

  const paidToCreditor = creditor === null ? 0 : available;
  const releasedTiles = state.tiles.flatMap((tile, i) => (tile.owner === debtorId ? [i] : []));
  let next: GameState = {
    ...updatePlayer(state, debtorId, () => ({
      cash: 0,
      deposit: 0,
      loan: 0,
      loanDue: null,
      bankrupt: true,
    })),
    tiles: state.tiles.map((tile) => (tile.owner === debtorId ? { ...tile, owner: null } : tile)),
  };
  let cause: BankruptcyCause;
  switch (debt.kind) {
    case 'rent':
      next = receive(next, debt.creditor, paidToCreditor);
      cause = { kind: 'rent', tile: debt.tile, amountDue: amount };
      break;
    case 'system':
      next = { ...next, lotteryPool: next.lotteryPool + available };
      cause = { kind: 'system', amountDue: amount };
      break;
    case 'loan':
      // The bank takes what there was and writes the rest off (docs/GAME_RULES.md §8).
      cause = { kind: 'loan', amountDue: amount };
      break;
  }
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
    releasedTiles,
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
