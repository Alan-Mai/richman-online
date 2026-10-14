// Hot-seat host: plays the server's role inside the browser. It is the only client module that
// calls legalActions/applyAction; the rest of the UI only sees ServerUpdate messages.
import {
  actorOf,
  applyAction,
  computerAction,
  createGame,
  legalActions,
  viewFor,
  type CreateGameError,
  type GameEvent,
  type GameSetup,
  type GameState,
  type ServerUpdate,
} from '@richman/shared';
import { sameIntent, type GameConnection, type HostMessage, type Intent } from './connection';

export type CreateHostResult =
  { ok: true; host: LocalGameHost } | { ok: false; errors: CreateGameError[] };

export class LocalGameHost implements GameConnection {
  private readonly listeners = new Set<(message: HostMessage) => void>();
  private started = false;

  private constructor(
    private state: GameState,
    private readonly openingEvents: readonly GameEvent[],
  ) {}

  static create(setup: GameSetup): CreateHostResult {
    const result = createGame(setup);
    if (!result.ok) {
      return { ok: false, errors: result.errors };
    }
    return { ok: true, host: new LocalGameHost(result.state, result.events) };
  }

  subscribe(listener: (message: HostMessage) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Sends the opening update (the first TurnStarted), then plays any computer seats up to the first
   * human decision; later calls do nothing.
   */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.broadcast(this.openingEvents);
    this.playComputers();
  }

  /** Every seat plays on this device, so an intent always acts for whoever the game waits for. */
  send(intent: Intent): void {
    const playerId = actorOf(this.state) ?? '';
    const action = legalActions(this.state, playerId).find((a) => sameIntent(a, intent));
    if (!this.started || action === undefined) {
      this.emit({ kind: 'rejected', intent, reason: { code: 'notLegal' } });
      return;
    }
    const result = applyAction(this.state, action);
    if (!result.ok) {
      this.emit({ kind: 'rejected', intent, reason: result.error });
      return;
    }
    this.state = result.state;
    this.broadcast(result.events);
    this.playComputers();
  }

  /**
   * Plays computerAction for computer seats, one update per action, until a human has to decide or
   * the game is over. The client's event queue paces them.
   */
  private playComputers(): void {
    for (;;) {
      const actor = actorOf(this.state);
      const action = actor === null ? null : computerAction(this.state, actor);
      if (action === null) return;
      const result = applyAction(this.state, action);
      if (!result.ok) {
        throw new Error(`computerAction was rejected: ${JSON.stringify(result.error)}`);
      }
      this.state = result.state;
      this.broadcast(result.events);
    }
  }

  /**
   * Hot-seat shows the table to whoever acts next (the current player once the game is over). A
   * computer's options are not offered to the screen.
   */
  private broadcast(events: readonly GameEvent[]): void {
    const playerId = actorOf(this.state) ?? this.state.turn.current;
    const human = this.state.players.find((p) => p.id === playerId)?.controller === 'human';
    const update: ServerUpdate = {
      events,
      view: viewFor(this.state, { kind: 'player', id: playerId }),
      legalActions: human ? legalActions(this.state, playerId) : [],
    };
    this.emit({ kind: 'update', update });
  }

  private emit(message: HostMessage): void {
    for (const listener of this.listeners) listener(message);
  }
}
