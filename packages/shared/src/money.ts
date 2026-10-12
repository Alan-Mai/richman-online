// Money movement: voluntary spending (buy, upgrade) and, later, forced payments.
import type { RuleConfig } from './config';
import type { GameEvent } from './events';
import type { PlayerId } from './ids';
import type { GameState, PlayerState } from './state';
import { playerOf, updatePlayer, type Step } from './update';

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

/** Voluntary payment to the bank (buying, upgrading); must be within spendable(). */
export function spend(state: GameState, playerId: PlayerId, amount: number): Step {
  if (amount > spendable(playerOf(state, playerId), state.config)) {
    throw new Error(`${playerId} cannot spend ${amount}`);
  }
  return withdraw(state, playerId, amount);
}
