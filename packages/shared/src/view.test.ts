import { describe, expect, it } from 'vitest';
import { newTestGame, patchTile, withFixedDice } from './testing';
import { viewFor } from './view';

describe('viewFor', () => {
  it('drops rngState', () => {
    const state = newTestGame();
    for (const s of [state, withFixedDice(state, [1, 2, 3])]) {
      const view = viewFor(s, 'p1');
      expect('rngState' in view).toBe(false);
      expect(JSON.stringify(view)).not.toContain('rngState');
      expect(JSON.stringify(view)).not.toContain('mulberry32');
      expect(JSON.stringify(view)).not.toContain('scripted');
    }
  });

  it('keeps everything else and records the viewer', () => {
    const state = patchTile(newTestGame({ playerCount: 3 }), 2, { owner: 'p2', level: 1 });
    const view = viewFor(state, 'p2');
    expect(view).toEqual({
      viewer: 'p2',
      config: state.config,
      board: state.board,
      players: state.players,
      tiles: state.tiles,
      turn: state.turn,
    });
    expect(viewFor(state, 'spectator').viewer).toBe('spectator');
  });

  it('does not mutate the state or share its per-game records', () => {
    const state = newTestGame();
    const snapshot = JSON.stringify(state);
    const view = viewFor(state, 'p1');
    expect(JSON.stringify(state)).toBe(snapshot);
    expect(view.players).not.toBe(state.players);
    expect(view.players[0]).not.toBe(state.players[0]);
    expect(view.tiles).not.toBe(state.tiles);
    expect(view.turn).not.toBe(state.turn);
  });
});
