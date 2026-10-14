import { describe, expect, it } from 'vitest';
import type { GameEvent } from './events';
import type { Controller, GameState } from './state';
import {
  applyOk,
  loopBoard,
  newTestGame,
  patchPlayer,
  patchTile,
  patchTurn,
  scriptedRng,
} from './testing';

/** Tile 1 belongs to p2 (rent 100); tiles 2..8 are properties the debtor may own. */
const BOARD = loopBoard([null, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, null]);

/**
 * `debtor` rolls a 1 onto p2's tile 1 with only 50 and goes bankrupt, owning tiles 2..6 (enough
 * for an auction if the game went on). `out` are already bankrupt. Others have plenty of cash.
 */
function bankruptcy(controllers: Controller[], debtor: string, out: string[] = []) {
  let state: GameState = newTestGame({
    board: BOARD,
    playerCount: controllers.length,
    controllers,
  });
  state = patchTurn(patchTile(state, 1, { owner: 'p2' }), { current: debtor });
  for (const tile of [2, 3, 4, 5, 6]) state = patchTile(state, tile, { owner: debtor, level: 1 });
  for (const p of state.players) {
    const bankrupt = out.includes(p.id);
    const cash = p.id === debtor || bankrupt ? 0 : 20_000;
    const deposit = p.id === debtor ? 50 : 0;
    state = patchPlayer(state, p.id, { cash, deposit, bankrupt });
  }
  // The die, then the property draws and computer limits should an auction follow.
  return applyOk(
    { ...state, rngState: scriptedRng(Array.from({ length: 20 }, () => 0)) },
    {
      type: 'rollDice',
      playerId: debtor,
    },
  );
}

const ended = (events: readonly GameEvent[]) => events.find((e) => e.type === 'GameEnded');

describe('games end when the humans are out (docs/GAME_RULES.md §1)', () => {
  it('ends with no winner when the only human seat goes bankrupt', () => {
    const { state, events } = bankruptcy(['human', 'computer', 'computer'], 'p1');
    expect(ended(events)).toMatchObject({ reason: 'humanBankrupt', winners: [] });
    expect(events.map((e) => e.type)).not.toContain('AuctionStarted');
    expect(state.turn.phase).toEqual({ kind: 'gameOver', winners: [] });
  });

  it('checks the only human before the last player standing', () => {
    const { events } = bankruptcy(['human', 'computer'], 'p1');
    expect(ended(events)).toMatchObject({ reason: 'humanBankrupt', winners: [] });
  });

  it('goes on when a computer goes bankrupt and a human is still in', () => {
    const { state, events } = bankruptcy(['computer', 'computer', 'human'], 'p1');
    expect(ended(events)).toBeUndefined();
    expect(state.turn.phase.kind).toBe('auction');
  });

  it('goes on when one of several humans goes bankrupt and another is still in', () => {
    const { state, events } = bankruptcy(['human', 'computer', 'human'], 'p1');
    expect(ended(events)).toBeUndefined();
    expect(state.turn.phase.kind).toBe('auction');
  });

  it('ends with no winner once no human is left in the game', () => {
    // p3 went bankrupt earlier; now p1, the other human, does too. p2 and p4 are still in.
    const { state, events } = bankruptcy(['human', 'computer', 'human', 'computer'], 'p1', ['p3']);
    expect(ended(events)).toMatchObject({ reason: 'noHumansLeft', winners: [] });
    expect(events.map((e) => e.type)).not.toContain('AuctionStarted');
    expect(state.turn.phase).toEqual({ kind: 'gameOver', winners: [] });
  });

  it('checks for humans left before the last player standing', () => {
    const { events } = bankruptcy(['human', 'computer', 'human'], 'p1', ['p3']);
    expect(ended(events)).toMatchObject({ reason: 'noHumansLeft', winners: [] });
  });

  it('ends a game between computers at its first bankruptcy', () => {
    const { events } = bankruptcy(['computer', 'computer', 'computer'], 'p1');
    expect(ended(events)).toMatchObject({ reason: 'noHumansLeft', winners: [] });
  });

  it('leaves games between humans to the last player standing', () => {
    const going = bankruptcy(['human', 'human', 'human'], 'p1');
    expect(ended(going.events)).toBeUndefined();
    const over = bankruptcy(['human', 'human'], 'p1');
    expect(ended(over.events)).toMatchObject({ reason: 'lastStanding', winners: ['p2'] });
  });
});
