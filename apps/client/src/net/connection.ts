import type { Action, RuleError, ServerUpdate } from '@richman/shared';

/** An action without its sender; the host fills in playerId (the server does so in Phase 4). */
export type Intent = Action extends infer A
  ? A extends Action
    ? Omit<A, 'playerId'>
    : never
  : never;

export type IntentRejection = { code: 'notLegal' } | RuleError;

export type HostMessage =
  | { kind: 'update'; update: ServerUpdate }
  /** The UI only offers legal actions, so a rejection points to a client bug. */
  | { kind: 'rejected'; intent: Intent; reason: IntentRejection };

/** How the UI talks to whoever runs the rules: the local hot-seat host now, a server later. */
export interface GameConnection {
  send(intent: Intent): void;
  /** Returns an unsubscribe function. */
  subscribe(listener: (message: HostMessage) => void): () => void;
}
