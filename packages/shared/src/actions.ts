import type { PlayerId } from './ids';

/** Player intents. playerId is filled in by the server from the sending connection. */
export type Action =
  | { type: 'rollDice'; playerId: PlayerId }
  | { type: 'buyProperty'; playerId: PlayerId }
  | { type: 'upgradeProperty'; playerId: PlayerId }
  /** Pass on the pending buy or upgrade offer. */
  | { type: 'decline'; playerId: PlayerId };

export type ActionType = Action['type'];
