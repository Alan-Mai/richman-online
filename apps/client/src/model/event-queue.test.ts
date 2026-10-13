import type { GameEvent, ServerUpdate } from '@richman/shared';
import { describe, expect, it } from 'vitest';
import { hotSeatSetup, playRandomGame } from '../testing/random-game';
import { displayFromView, type DisplayModel } from './display';
import { EventQueue, type Animator, type EventQueueListener } from './event-queue';

/** Animator whose animations finish only when the test says so. */
class ManualAnimator implements Animator {
  readonly played: GameEvent[] = [];
  private resolvers: (() => void)[] = [];
  failOn: GameEvent['type'] | null = null;

  play(event: GameEvent): Promise<void> {
    this.played.push(event);
    if (event.type === this.failOn) return Promise.reject(new Error('boom'));
    return new Promise((resolve) => this.resolvers.push(resolve));
  }

  get waiting(): number {
    return this.resolvers.length;
  }

  /** Finishes animations one by one until none is waiting. */
  async finishAll(): Promise<void> {
    for (let i = 0; i < 10_000; i++) {
      await flush();
      const next = this.resolvers.shift();
      if (!next) return;
      next();
    }
  }
}

const instant: Animator = { play: () => Promise.resolve() };

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function recorder() {
  const log = {
    busy: [] as boolean[],
    ready: [] as ServerUpdate[],
    displays: [] as DisplayModel[],
    mismatches: [] as string[][],
    errors: [] as GameEvent['type'][],
    played: [] as GameEvent['type'][],
  };
  const listener: EventQueueListener = {
    onDisplay: (m) => log.displays.push(m),
    onEventPlayed: (e) => log.played.push(e.type),
    onBusyChange: (b) => log.busy.push(b),
    onReady: (u) => log.ready.push(u),
    onMismatch: (d) => log.mismatches.push(d),
    onAnimationError: (_, e) => log.errors.push(e.type),
  };
  return { log, listener };
}

async function idle(queue: EventQueue): Promise<void> {
  for (let i = 0; i < 10_000 && queue.busy; i++) await flush();
}

const updates = playRandomGame(hotSeatSetup(31));

describe('EventQueue', () => {
  it('plays every event in order and ends on the last view', async () => {
    const animator = new ManualAnimator();
    const { log, listener } = recorder();
    const queue = new EventQueue(animator, listener);
    for (const update of updates) queue.push(update);
    await animator.finishAll();
    await idle(queue);

    expect(animator.played).toEqual(updates.flatMap((u) => u.events));
    expect(log.played).toEqual(updates.flatMap((u) => u.events.map((e) => e.type)));
    expect(log.mismatches).toEqual([]);
    expect(queue.display).toEqual(displayFromView(updates.at(-1)!.view));
  });

  it('is busy while playing and offers actions only after the last event', async () => {
    const animator = new ManualAnimator();
    const { log, listener } = recorder();
    const queue = new EventQueue(animator, listener);
    const [first, second] = updates;

    queue.push(first!);
    expect(queue.busy).toBe(true);
    expect(log.busy).toEqual([true]);
    await flush();
    expect(animator.waiting).toBe(1);
    expect(log.ready).toEqual([]);

    await animator.finishAll();
    await idle(queue);
    expect(log.busy).toEqual([true, false]);
    expect(log.ready).toEqual([first]);

    queue.push(second!);
    expect(log.busy).toEqual([true, false, true]);
    await animator.finishAll();
    await idle(queue);
    expect(log.ready).toEqual([first, second]);
  });

  it('queues updates that arrive while playing and offers only the newest actions', async () => {
    const animator = new ManualAnimator();
    const { log, listener } = recorder();
    const queue = new EventQueue(animator, listener);
    queue.push(updates[0]!);
    await flush();
    queue.push(updates[1]!);
    queue.push(updates[2]!);
    expect(log.busy).toEqual([true]);

    await animator.finishAll();
    await idle(queue);
    expect(log.busy).toEqual([true, false]);
    expect(log.ready).toEqual([updates[2]]);
    expect(animator.played).toEqual(updates.slice(0, 3).flatMap((u) => u.events));
  });

  it('shows the model before each event and the result after it', async () => {
    const seen: [GameEvent['type'], DisplayModel, DisplayModel][] = [];
    const animator: Animator = {
      play: (event, before, after) => {
        seen.push([event.type, before, after]);
        return Promise.resolve();
      },
    };
    const queue = new EventQueue(animator, recorder().listener);
    for (const update of updates.slice(0, 4)) queue.push(update);
    await idle(queue);

    const moved = seen.find(([type]) => type === 'PlayerMoved');
    expect(moved).toBeDefined();
    const [, before, after] = moved!;
    expect(after.players.find((p) => p.id === 'p1')?.position).not.toBe(
      before.players.find((p) => p.id === 'p1')?.position,
    );
  });

  it('snaps to the view and reports when events do not reproduce it', async () => {
    const { log, listener } = recorder();
    const queue = new EventQueue(instant, listener);
    queue.push(updates[0]!);
    const tampered: ServerUpdate = {
      ...updates[1]!,
      view: {
        ...updates[1]!.view,
        players: updates[1]!.view.players.map((p, i) => (i === 0 ? { ...p, cash: p.cash + 1 } : p)),
      },
    };
    queue.push(tampered);
    await idle(queue);

    expect(log.mismatches).toHaveLength(1);
    expect(log.mismatches[0]?.[0]).toMatch(/^players\[0\]\.cash/);
    expect(queue.display).toEqual(displayFromView(tampered.view));
    expect(log.displays.at(-1)).toEqual(displayFromView(tampered.view));
  });

  it('keeps going when an animation fails', async () => {
    const animator = new ManualAnimator();
    animator.failOn = 'DiceRolled';
    const { log, listener } = recorder();
    const queue = new EventQueue(animator, listener);
    queue.push(updates[0]!);
    queue.push(updates[1]!);
    await animator.finishAll();
    await idle(queue);

    expect(log.errors).toEqual(['DiceRolled']);
    expect(log.mismatches).toEqual([]);
    expect(log.ready).toEqual([updates[1]]);
  });
});
