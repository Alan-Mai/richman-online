import { describe, expect, it } from 'vitest';
import type { HostMessage } from './connection';
import { LocalGameHost } from './local-host';
import { createHost, hotSeatSetup, playRandomGame } from '../testing/random-game';

function record(host: LocalGameHost): HostMessage[] {
  const messages: HostMessage[] = [];
  host.subscribe((m) => messages.push(m));
  return messages;
}

function lastUpdate(messages: HostMessage[]) {
  const found = messages.findLast((m) => m.kind === 'update');
  if (found?.kind !== 'update') throw new Error('no update');
  return found.update;
}

describe('LocalGameHost', () => {
  it('reports createGame errors instead of throwing', () => {
    const result = LocalGameHost.create(hotSeatSetup(1, 'dayLimit', 1));
    expect(result.ok).toBe(false);
  });

  it('sends the opening TurnStarted and seat 0 placement once, with seat 0 to roll', () => {
    const host = createHost(hotSeatSetup(7));
    const messages = record(host);
    host.start();
    host.start();

    expect(messages).toHaveLength(1);
    const update = lastUpdate(messages);
    expect(update.events.map((e) => e.type)).toEqual(['TurnStarted', 'PlayerPlaced']);
    expect(update.events[0]).toEqual({ type: 'TurnStarted', playerId: 'p1', round: 1 });
    expect(update.view.viewer).toEqual({ kind: 'player', id: 'p1' });
    expect(update.legalActions).toEqual([{ type: 'rollDice', playerId: 'p1' }]);
  });

  it('does not leak the RNG state', () => {
    const host = createHost(hotSeatSetup(7));
    const messages = record(host);
    host.start();
    expect(lastUpdate(messages).view).not.toHaveProperty('rngState');
  });

  it('rejects intents before start', () => {
    const host = createHost(hotSeatSetup(7));
    const messages = record(host);
    host.send({ type: 'rollDice' });
    expect(messages).toEqual([
      { kind: 'rejected', intent: { type: 'rollDice' }, reason: { code: 'notLegal' } },
    ]);
  });

  it('rejects an intent that is not offered and leaves the game unchanged', () => {
    const host = createHost(hotSeatSetup(7));
    const messages = record(host);
    host.start();

    host.send({ type: 'buyProperty' });
    expect(messages).toHaveLength(2);
    expect(messages[1]).toEqual({
      kind: 'rejected',
      intent: { type: 'buyProperty' },
      reason: { code: 'notLegal' },
    });

    host.send({ type: 'rollDice' });
    expect(messages).toHaveLength(3);
    expect(lastUpdate(messages).events[0]).toMatchObject({ type: 'DiceRolled', playerId: 'p1' });
  });

  it('stops delivering to unsubscribed listeners', () => {
    const host = createHost(hotSeatSetup(7));
    const messages: HostMessage[] = [];
    const unsubscribe = host.subscribe((m) => messages.push(m));
    unsubscribe();
    host.start();
    expect(messages).toEqual([]);
  });

  it('acts for the current player and shows the table to whoever acts next', () => {
    const updates = playRandomGame(hotSeatSetup(11));
    for (const update of updates) {
      const { phase, current } = update.view.turn;
      const actor = phase.kind === 'auction' ? phase.bidder : current;
      expect(update.view.viewer).toEqual({ kind: 'player', id: actor });
      expect(update.legalActions.every((a) => a.playerId === actor)).toBe(true);
    }
  });

  it('plays computer seats itself and offers nothing while a computer acts', () => {
    const host = createHost(hotSeatSetup(5, 'dayLimit', 3, ['computer', 'human', 'computer']));
    const messages = record(host);
    host.start();
    const updates = messages.flatMap((m) => (m.kind === 'update' ? [m.update] : []));
    // p1 (a computer) rolls and maybe buys before p2 has to decide.
    expect(updates.length).toBeGreaterThan(1);
    for (const update of updates.slice(0, -1)) expect(update.legalActions).toEqual([]);
    const last = lastUpdate(messages);
    expect(last.view.turn.current).toBe('p2');
    expect(last.legalActions).toEqual([{ type: 'rollDice', playerId: 'p2' }]);

    host.send({ type: 'rollDice' });
    const after = messages.flatMap((m) => (m.kind === 'update' ? [m.update] : []));
    expect(after.length).toBeGreaterThan(updates.length);
    expect(messages.some((m) => m.kind === 'rejected')).toBe(false);
  });

  it('plays a game between computers to the end on start', () => {
    const host = createHost(hotSeatSetup(3, 'dayLimit', 2, ['computer', 'computer']));
    const messages = record(host);
    host.start();
    expect(lastUpdate(messages).view.turn.phase.kind).toBe('gameOver');
  });

  it.each([1, 2, 3, 4, 5])('plays a round-limit game to the end (seed %i)', (seed) => {
    const updates = playRandomGame(hotSeatSetup(seed));
    const last = updates.at(-1)!;
    expect(last.view.turn.phase.kind).toBe('gameOver');
    expect(last.legalActions).toEqual([]);
    expect(last.events.at(-1)?.type).toBe('GameEnded');
  });

  it.each([1, 2, 3])('plays a last-standing game to the end (seed %i)', (seed) => {
    const updates = playRandomGame(hotSeatSetup(seed, 'lastStanding'), 200_000);
    expect(updates.at(-1)!.view.turn.phase.kind).toBe('gameOver');
  });
});
