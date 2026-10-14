import { describe, expect, it } from 'vitest';
import type { AuctionPhase } from './state';
import {
  newTestGame,
  patchPlayer,
  patchTile,
  patchTurn,
  placePlayer,
  withFixedDice,
} from './testing';
import { viewFor, type Viewer } from './view';

const P1: Viewer = { kind: 'player', id: 'p1' };
const SPECTATOR: Viewer = { kind: 'spectator' };

describe('viewFor', () => {
  it('drops rngState', () => {
    const state = newTestGame();
    for (const s of [state, withFixedDice(state, [1, 2, 3])]) {
      for (const viewer of [P1, SPECTATOR]) {
        const view = viewFor(s, viewer);
        expect('rngState' in view).toBe(false);
        expect(JSON.stringify(view)).not.toContain('rngState');
        expect(JSON.stringify(view)).not.toContain('mulberry32');
        expect(JSON.stringify(view)).not.toContain('scripted');
      }
    }
  });

  it('keeps everything else and records the viewer', () => {
    const base = patchTile(newTestGame({ playerCount: 3 }), 2, { owner: 'p2', level: 1 });
    const state = { ...base, day: 4, priceIndex: 2, lotteryPool: 7000 };
    const view = viewFor(state, { kind: 'player', id: 'p2' });
    expect(view).toEqual({
      viewer: { kind: 'player', id: 'p2' },
      config: state.config,
      board: state.board,
      players: state.players,
      tiles: state.tiles,
      turn: state.turn,
      day: 4,
      priceIndex: 2,
    });
    expect(viewFor(state, SPECTATOR).viewer).toEqual({ kind: 'spectator' });
  });

  it('sends where each player stands and came from, or that they are not placed yet', () => {
    const state = placePlayer(newTestGame({ playerCount: 3, placement: 'engine' }), 'p1', 4, 5);
    const view = viewFor(state, SPECTATOR);
    expect(view.players.map((p) => p.location)).toEqual([
      { kind: 'onBoard', tile: 4, prev: 5 },
      { kind: 'offBoard' },
      { kind: 'offBoard' },
    ]);
    expect(view.players[0]?.location).not.toBe(state.players[0]?.location);
  });

  it('does not send the lottery pool', () => {
    const state = { ...newTestGame(), lotteryPool: 123_456 };
    const view = viewFor(state, SPECTATOR);
    expect('lotteryPool' in view).toBe(false);
    expect(JSON.stringify(view)).not.toContain('123456');
  });

  it('sends the open auction but neither the drawn properties to come nor computer limits', () => {
    const phase: AuctionPhase = {
      kind: 'auction',
      tile: 2,
      queue: [17, 13],
      startPrice: 1500,
      price: 2000,
      leader: 'p2',
      bidder: 'p3',
      bidders: [
        { id: 'p2', status: 'bidding' },
        { id: 'p3', status: 'passed' },
      ],
      computerLimits: { p3: 98_765 },
    };
    const base = patchPlayer(newTestGame({ playerCount: 3 }), 'p1', { bankrupt: true });
    const state = patchTurn(base, { phase });
    for (const viewer of [P1, SPECTATOR]) {
      const view = viewFor(state, viewer);
      const { queue, computerLimits, ...open } = phase;
      expect(queue).toHaveLength(2);
      expect(computerLimits).toEqual({ p3: 98_765 });
      expect(view.turn.phase).toEqual({ ...open, remaining: 2 });
      expect('queue' in view.turn.phase).toBe(false);
      expect(JSON.stringify(view)).not.toContain('98765');
    }
  });

  it("sends each player's controller", () => {
    const state = newTestGame({ playerCount: 3, controllers: ['computer', 'human', 'computer'] });
    for (const viewer of [P1, SPECTATOR]) {
      expect(viewFor(state, viewer).players.map((p) => p.controller)).toEqual([
        'computer',
        'human',
        'computer',
      ]);
    }
  });

  it('keeps a player whose id is "spectator" distinct from a spectator', () => {
    const state = newTestGame();
    expect(viewFor(state, { kind: 'player', id: 'spectator' }).viewer).toEqual({
      kind: 'player',
      id: 'spectator',
    });
  });

  it('does not mutate the state or share its per-game records', () => {
    const state = newTestGame();
    const snapshot = JSON.stringify(state);
    const viewer: Viewer = { kind: 'player', id: 'p1' };
    const view = viewFor(state, viewer);
    expect(JSON.stringify(state)).toBe(snapshot);
    expect(view.viewer).not.toBe(viewer);
    expect(view.players).not.toBe(state.players);
    expect(view.players[0]).not.toBe(state.players[0]);
    expect(view.tiles).not.toBe(state.tiles);
    expect(view.turn).not.toBe(state.turn);
  });
});
