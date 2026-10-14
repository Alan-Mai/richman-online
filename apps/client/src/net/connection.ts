import type { Action, RuleError, ServerUpdate } from '@richman/shared';

/** An action without its sender; the host fills in playerId (the server does so in Phase 4). */
export type Intent = Action extends infer A
  ? A extends Action
    ? Omit<A, 'playerId'>
    : never
  : never;

/** The action as its sender would send it, without playerId. */
export function toIntent(action: Action): Intent {
  const entries = Object.entries(action).filter(([key]) => key !== 'playerId');
  return Object.fromEntries(entries) as Intent;
}

/** Whether the action is the intent with a sender filled in. */
export function sameIntent(action: Action, intent: Intent): boolean {
  return JSON.stringify(toIntent(action)) === JSON.stringify(intent);
}

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
