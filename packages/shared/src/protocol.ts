import type { LegalAction } from './actions';
import type { GameEvent } from './events';
import type { PlayerView } from './view';

/** What the server sends one player after each accepted action (docs/ARCHITECTURE.md). */
export interface ServerUpdate {
  /** Events produced by the action, in the order the client should play them. */
  events: readonly GameEvent[];
  /** viewFor(state, the receiving viewer). */
  view: PlayerView;
  /**
   * legalActions(state, playerId); empty when it is not this player's turn. Ranges (amounts) are
   * offered as one option each; see allows.
   */
  legalActions: readonly LegalAction[];
}
