import type { PlayerId, TileIndex } from './ids';

/** The debt that could not be paid; amountDue is the full amount, not what was paid. */
export type BankruptcyCause =
  { kind: 'rent'; tile: TileIndex; amountDue: number } | { kind: 'system'; amountDue: number };

/** What happened, in order, for the client to animate. */
export type GameEvent =
  | { type: 'TurnStarted'; playerId: PlayerId; round: number }
  /** A player's first turn put them on the board, facing away from prev. */
  | { type: 'PlayerPlaced'; playerId: PlayerId; tile: TileIndex; prev: TileIndex }
  | { type: 'DiceRolled'; playerId: PlayerId; dice: readonly number[]; total: number }
  /** Every tile stepped on, in order, ending with the landing tile. */
  | { type: 'PlayerMoved'; playerId: PlayerId; path: readonly TileIndex[] }
  | { type: 'PropertyBought'; playerId: PlayerId; tile: TileIndex; price: number }
  | { type: 'PropertyUpgraded'; playerId: PlayerId; tile: TileIndex; level: number; cost: number }
  | { type: 'RentPaid'; from: PlayerId; to: PlayerId; tile: TileIndex; amount: number }
  /** Cash fell short of a payment and the rest came out of the deposit. */
  | { type: 'DepositWithdrawn'; playerId: PlayerId; amount: number }
  | {
      type: 'PlayerBankrupt';
      playerId: PlayerId;
      /** null when the debt was owed to the system. */
      creditor: PlayerId | null;
      paidToCreditor: number;
      releasedTiles: readonly TileIndex[];
      cause: BankruptcyCause;
    }
  | {
      type: 'GameEnded';
      reason: 'lastStanding' | 'roundLimit';
      winners: readonly PlayerId[];
      totalAssets: Readonly<Record<PlayerId, number>>;
    };

export type GameEventType = GameEvent['type'];
