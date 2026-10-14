import { describe, expect, it } from 'vitest';
import { validateBoard, type Board } from './board';
import { DEFAULT_RULE_CONFIG } from './config';
import { checkInvariants } from './invariants';
import type { GameState } from './state';
import { applyOk, loopBoard, newTestGame, patchTile, tileOf, withFixedDice } from './testing';
import { viewFor } from './view';

/** A loop whose tile 2 stands for a large building the engine does not implement. */
const BOARD: Board = (() => {
  const loop = loopBoard([null, 1000, 2000, 1000, null, null]);
  const tiles = loop.tiles.map((tile, i) =>
    i === 2
      ? {
          kind: 'unsupported' as const,
          feature: 'largeBuilding' as const,
          name: tile.name,
          links: tile.links,
          pos: tile.pos,
        }
      : tile,
  );
  return { ...loop, tiles };
})();

const game = (): GameState => newTestGame({ board: BOARD });

describe('unsupported tiles', () => {
  it('are valid board content', () => {
    expect(validateBoard(BOARD, DEFAULT_RULE_CONFIG)).toEqual([]);
  });

  it('do nothing when a player stops on them', () => {
    // Other players own land, so a stray rent or upgrade would show up in money or tiles.
    const owned = patchTile(patchTile(game(), 1, { owner: 'p2', level: 2 }), 3, { owner: 'p1' });
    const start = withFixedDice(owned, [2]);
    const { state, events } = applyOk(start, { type: 'rollDice', playerId: 'p1' });
    expect(events).toEqual([
      { type: 'DiceRolled', playerId: 'p1', dice: [2], total: 2 },
      { type: 'PlayerMoved', playerId: 'p1', path: [1, 2] },
      { type: 'TurnStarted', playerId: 'p2', round: 1 },
    ]);
    expect(tileOf(state, 'p1')).toBe(2);
    const money = (s: GameState) => s.players.map(({ cash, deposit }) => ({ cash, deposit }));
    expect(money(state)).toEqual(money(start));
    expect(state.tiles).toEqual(start.tiles);
  });

  it('can be walked over', () => {
    const { state } = applyOk(withFixedDice(game(), [3]), { type: 'rollDice', playerId: 'p1' });
    expect(tileOf(state, 'p1')).toBe(3);
    expect(state.turn.phase.kind).toBe('awaitBuyDecision');
  });

  it('can never be owned or built on', () => {
    expect(checkInvariants(patchTile(game(), 2, { owner: 'p1' }))).toEqual([
      'tile 2: not a property but has owner p1 and level 0',
    ]);
  });

  it('are sent to clients as part of the board', () => {
    const view = viewFor(game(), { kind: 'spectator' });
    expect(view.board.tiles[2]).toMatchObject({ kind: 'unsupported', feature: 'largeBuilding' });
  });
});
