// Money movement: voluntary spending (buy, upgrade) and forced payments (rent, system debts).
import type { PropertyTileDef } from './board';
import type { RuleConfig } from './config';
import type { BankruptcyCause, GameEvent } from './events';
import type { PlayerId, TileIndex } from './ids';
import type { GameState, PlayerState } from './state';
import { playerOf, updatePlayer, type Step } from './update';

/** Rent at `level`: the tile's own rentTable when present, otherwise a percentage of the price. */
export function rentFor(tile: PropertyTileDef, level: number, config: RuleConfig): number {
  const fromTable = tile.rentTable?.[level];
  if (fromTable !== undefined) {
    return fromTable;
  }
  return Math.floor((tile.price * (config.rentPercentByLevel[level] ?? 0)) / 100);
}

/** Cost of one upgrade level; the same for every level. */
export function upgradeCost(price: number, config: RuleConfig): number {
  return Math.floor((price * config.upgradeCostPercent) / 100);
}

/**
 * Cash + deposit + what the player invested in their properties (price plus each built level at
 * upgradeCost), as used by richestAtRoundLimit (docs/GAME_RULES.md §1).
 */
export function totalAssets(state: GameState, playerId: PlayerId): number {
  const player = playerOf(state, playerId);
  let total = player.cash + player.deposit;
  state.tiles.forEach((tile, i) => {
    const def = state.board.tiles[i];
    if (tile.owner === playerId && def?.kind === 'property') {
      total += def.price + tile.level * upgradeCost(def.price, state.config);
    }
  });
  return total;
}

/** Money the player may spend voluntarily under RuleConfig.purchaseFunds. */
export function spendable(player: PlayerState, config: RuleConfig): number {
  return config.purchaseFunds === 'cashAndDeposit' ? player.cash + player.deposit : player.cash;
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
 * and a player creditor receives what RuleConfig.bankruptcyPayout says. Bankruptcy emits only
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

  const paidToCreditor = creditor === null ? 0 : bankruptcyPayout(available, amount, state.config);
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

function bankruptcyPayout(available: number, amount: number, config: RuleConfig): number {
  switch (config.bankruptcyPayout) {
    case 'remaining':
      return Math.min(available, amount);
    case 'full':
      return amount;
    case 'none':
      return 0;
  }
}

function receive(state: GameState, playerId: PlayerId, amount: number): GameState {
  return updatePlayer(state, playerId, (p) => ({ cash: p.cash + amount }));
}

/** Voluntary payment to the bank (buying, upgrading); must be within spendable(). */
export function spend(state: GameState, playerId: PlayerId, amount: number): Step {
  if (amount > spendable(playerOf(state, playerId), state.config)) {
    throw new Error(`${playerId} cannot spend ${amount}`);
  }
  return withdraw(state, playerId, amount);
}
