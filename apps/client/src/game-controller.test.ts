import type { ServerUpdate } from '@richman/shared';
import { describe, expect, it } from 'vitest';
import { GameController, type ControllerSink } from './game-controller';
import type { Animator } from './model/event-queue';
import { createHost, hotSeatSetup } from './testing/random-game';

const instant: Animator = { play: () => Promise.resolve() };

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function setup() {
  const host = createHost(hotSeatSetup(41));
  const ready: (ServerUpdate | null)[] = [];
  const busy: boolean[] = [];
  const sink: ControllerSink = {
    setReady: (u) => ready.push(u),
    setBusy: (b) => busy.push(b),
  };
  const log = { warnings: [] as string[], errors: [] as string[] };
  const controller = new GameController(host, instant, [sink], {
    warn: (m) => log.warnings.push(m),
    error: (m) => log.errors.push(m),
  });
  return { host, controller, ready, busy, log };
}

describe('GameController', () => {
  it('offers nothing until the opening update has played', async () => {
    const { host, controller, ready } = setup();
    expect(controller.available).toEqual([]);
    host.start();
    expect(controller.available).toEqual([]);
    await flush();
    expect(controller.available).toEqual([{ type: 'rollDice', playerId: 'p1' }]);
    expect(ready.at(-1)?.legalActions).toEqual([{ type: 'rollDice', playerId: 'p1' }]);
  });

  it('refuses actions that are not offered', async () => {
    const { host, controller, log } = setup();
    host.start();
    await flush();
    expect(controller.act({ type: 'buyProperty' })).toBe(false);
    expect(controller.act({ type: 'bid', raise: 100 })).toBe(false);
    expect(log.errors).toEqual([]);
  });

  it('locks input from sending until the result has played', async () => {
    const { host, controller, log } = setup();
    host.start();
    await flush();
    expect(controller.act({ type: 'rollDice' })).toBe(true);
    expect(controller.available).toEqual([]);
    expect(controller.act({ type: 'rollDice' })).toBe(false);
    await flush();
    expect(controller.available.length).toBeGreaterThan(0);
    expect(log.errors).toEqual([]);
    expect(log.warnings).toEqual([]);
  });

  it('stops listening after dispose', async () => {
    const { host, controller } = setup();
    controller.dispose();
    host.start();
    await flush();
    expect(controller.available).toEqual([]);
  });
});
