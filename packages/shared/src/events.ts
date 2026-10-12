import type { PlayerId, TileIndex } from './ids';

/** What happened, in order, for the client to animate. */
export type GameEvent =
  | { type: 'TurnStarted'; playerId: PlayerId; round: number }
  | { type: 'DiceRolled'; playerId: PlayerId; dice: readonly number[]; total: number }
  /** Every tile stepped on, in order, ending with the landing tile. */
  | { type: 'PlayerMoved'; playerId: PlayerId; path: readonly TileIndex[] }
  | { type: 'PassBonusReceived'; playerId: PlayerId; tile: TileIndex; amount: number }
  | { type: 'PropertyBought'; playerId: PlayerId; tile: TileIndex; price: number }
  | { type: 'PropertyUpgraded'; playerId: PlayerId; tile: TileIndex; level: number; cost: number }
  | { type: 'RentPaid'; from: PlayerId; to: PlayerId; tile: TileIndex; amount: number }
  /** Cash fell short of a debt and the rest came out of the deposit. */
  | { type: 'DepositWithdrawn'; playerId: PlayerId; amount: number }
  | {
      type: 'PlayerBankrupt';
      playerId: PlayerId;
      /** null when the debt was owed to the system. */
      creditor: PlayerId | null;
      paidToCreditor: number;
      releasedTiles: readonly TileIndex[];
    }
  | {
      type: 'GameEnded';
      reason: 'lastStanding' | 'roundLimit';
      winners: readonly PlayerId[];
      totalAssets: Readonly<Record<PlayerId, number>>;
    };

export type GameEventType = GameEvent['type'];
