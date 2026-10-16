// Connects a GameConnection to the screen: updates go through the EventQueue, and the player can
// act only when playback has finished and the action is in the latest legal list.
import type { GameEvent, LegalAction, ServerUpdate } from '@richman/shared';
import type { DisplayModel } from './model/display';
import { EventQueue, type Animator } from './model/event-queue';
import { offerAllows, type GameConnection, type Intent } from './net/connection';

export interface ControllerSink {
  showModel?(model: DisplayModel): void;
  /** An event finished playing; `model` is the display after it, `update` the one it came in. */
  eventPlayed?(event: GameEvent, model: DisplayModel, update: ServerUpdate): void;
  /** An event is about to play; `model` is the display it ends on. */
  eventStarted?(event: GameEvent, model: DisplayModel): void;
  setBusy?(busy: boolean): void;
  /** The update whose legal actions may now be offered; null while playing. */
  setReady?(update: ServerUpdate | null): void;
}

export interface ControllerLog {
  warn(message: string): void;
  error(message: string): void;
}

export class GameController {
  private readonly queue: EventQueue;
  private ready: ServerUpdate | null = null;
  private readonly unsubscribe: () => void;

  constructor(
    private readonly connection: GameConnection,
    animator: Animator,
    private readonly sinks: readonly ControllerSink[],
    log: ControllerLog = console,
  ) {
    this.queue = new EventQueue(animator, {
      onDisplay: (model) => this.sinks.forEach((s) => s.showModel?.(model)),
      onEventPlayed: (event, model, update) =>
        this.sinks.forEach((s) => s.eventPlayed?.(event, model, update)),
      onEventStarted: (event, model) => this.sinks.forEach((s) => s.eventStarted?.(event, model)),
      onBusyChange: (busy) => {
        if (busy) this.setReady(null);
        this.sinks.forEach((s) => s.setBusy?.(busy));
      },
      onReady: (update) => this.setReady(update),
      onMismatch: (diffs) => log.warn(`events did not reproduce the view: ${diffs.join('; ')}`),
      onAnimationError: (error, event) =>
        log.error(`animation for ${event.type} failed: ${String(error)}`),
    });
    this.unsubscribe = connection.subscribe((message) => {
      if (message.kind === 'update') {
        this.queue.push(message.update);
      } else {
        log.error(`intent ${message.intent.type} rejected: ${message.reason.code}`);
      }
    });
  }

  /** The actions the player may choose right now. */
  get available(): readonly LegalAction[] {
    return this.ready?.legalActions ?? [];
  }

  /** Sends the intent if it is currently offered; returns whether it was sent. */
  act(intent: Intent): boolean {
    if (!this.available.some((a) => offerAllows(a, intent))) return false;
    // Lock input until the resulting update has played.
    this.setReady(null);
    this.connection.send(intent);
    return true;
  }

  dispose(): void {
    this.unsubscribe();
  }

  private setReady(update: ServerUpdate | null): void {
    this.ready = update;
    this.sinks.forEach((s) => s.setReady?.(update));
  }
}
