// What one client may see. Fields are copied by name so new GameState fields stay hidden until
// they are deliberately added here.
import type { Board } from './board';
import type { RuleConfig } from './config';
import type { PlayerId } from './ids';
import type { GameState, PlayerState, TileState, TurnState } from './state';

/** PlayerId is a plain string, so 'spectator' is documentation only (see ARCHITECTURE.md). */
// eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
export type Viewer = PlayerId | 'spectator';

export interface PlayerView {
  viewer: Viewer;
  config: RuleConfig;
  board: Board;
  players: readonly PlayerState[];
  tiles: readonly TileState[];
  turn: TurnState;
}

/**
 * Filters the state for one viewer. Phase 2 has no per-player secrets, so only rngState is
 * dropped; later hidden fields (hands of cards) are filtered here per viewer.
 */
export function viewFor(state: GameState, viewer: Viewer): PlayerView {
  return {
    viewer,
    config: state.config,
    board: state.board,
    players: state.players.map((p) => ({ ...p })),
    tiles: state.tiles.map((t) => ({ ...t })),
    turn: { ...state.turn },
  };
}
