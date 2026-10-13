// Plays server updates one event at a time and keeps input locked until everything has played.
import type { GameEvent, ServerUpdate } from '@richman/shared';
import { applyEventToDisplay, diffDisplay, displayFromView, type DisplayModel } from './display';

export interface Animator {
  /** Plays one event; resolves when the animation is done. `after` is what it should end on. */
  play(event: GameEvent, before: DisplayModel, after: DisplayModel): Promise<void>;
}

export interface EventQueueListener {
  /** The shown model changed (after each event, and after a correction). */
  onDisplay(model: DisplayModel): void;
  onBusyChange(busy: boolean): void;
  /** Everything has played; the update's legal actions may now be offered. */
  onReady(update: ServerUpdate): void;
  /** The events did not reproduce the view; the display has been snapped to the view. */
  onMismatch(diffs: string[]): void;
  /** An animation failed; playback skips to the next event. */
  onAnimationError(error: unknown, event: GameEvent): void;
  /** An event has finished playing; `model` is the display after it. */
  onEventPlayed(event: GameEvent, model: DisplayModel): void;
}

export class EventQueue {
  private readonly pending: ServerUpdate[] = [];
  private running = false;
  private model: DisplayModel | null = null;

  constructor(
    private readonly animator: Animator,
    private readonly listener: EventQueueListener,
  ) {}

  get busy(): boolean {
    return this.running;
  }

  get display(): DisplayModel | null {
    return this.model;
  }

  push(update: ServerUpdate): void {
    this.pending.push(update);
    if (!this.running) {
      this.running = true;
      this.listener.onBusyChange(true);
      void this.drain();
    }
  }

  private async drain(): Promise<void> {
    let last: ServerUpdate | undefined;
    for (let update = this.pending.shift(); update; update = this.pending.shift()) {
      await this.playUpdate(update);
      last = update;
    }
    this.running = false;
    this.listener.onBusyChange(false);
    // Only the newest update's actions are current; earlier ones were superseded while playing.
    if (last) this.listener.onReady(last);
  }

  private async playUpdate(update: ServerUpdate): Promise<void> {
    const expected = displayFromView(update.view);
    // The first update is a snapshot: its events (the opening TurnStarted) are animated on top of
    // the view without being folded in again.
    const snapshot = this.model === null;
    if (snapshot) {
      this.model = expected;
      this.listener.onDisplay(expected);
    }

    for (const event of update.events) {
      const before = this.model ?? expected;
      const after = snapshot ? before : applyEventToDisplay(before, event);
      try {
        await this.animator.play(event, before, after);
      } catch (error) {
        this.listener.onAnimationError(error, event);
      }
      this.model = after;
      if (after !== before) this.listener.onDisplay(after);
      this.listener.onEventPlayed(event, after);
    }

    const diffs = diffDisplay(this.model ?? expected, expected);
    if (diffs.length > 0) {
      this.listener.onMismatch(diffs);
      this.model = expected;
      this.listener.onDisplay(expected);
    }
  }
}
