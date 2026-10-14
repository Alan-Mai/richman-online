import type { PlayerId } from './ids';

/** Player intents. playerId is filled in by the server from the sending connection. */
export type Action =
  | { type: 'rollDice'; playerId: PlayerId }
  | { type: 'buyProperty'; playerId: PlayerId }
  | { type: 'upgradeProperty'; playerId: PlayerId }
  /** Pass on the pending buy or upgrade offer. */
  | { type: 'decline'; playerId: PlayerId }
  /** Raise the auction price by one of RuleConfig.auctionRaises. */
  | { type: 'bid'; playerId: PlayerId; raise: number }
  /** Pass this round of the auction; asked again after the next raise. */
  | { type: 'passRound'; playerId: PlayerId }
  /** Leave the auction for good. */
  | { type: 'withdraw'; playerId: PlayerId };

export type ActionType = Action['type'];
