// Small immutable-update helpers shared by the engine modules. Not exported from index.ts.
import type { GameEvent } from './events';
import type { PlayerId, TileIndex } from './ids';
import type { GameState, PlayerState, TileState } from './state';

/** A state transition together with the events it produced. */
export interface Step {
  state: GameState;
  events: GameEvent[];
}

/** Runs `next` on the state after `step` and concatenates the events. */
export function chain(step: Step, next: (state: GameState) => Step): Step {
  const after = next(step.state);
  return { state: after.state, events: [...step.events, ...after.events] };
}

/** Reads an index the engine has already validated; a miss is an engine bug. */
export function at<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) {
    throw new Error(`index ${index} out of range`);
  }
  return item;
}

export function findPlayer(state: GameState, id: PlayerId): PlayerState | undefined {
  return state.players.find((p) => p.id === id);
}

export function playerOf(state: GameState, id: PlayerId): PlayerState {
  const player = findPlayer(state, id);
  if (player === undefined) {
    throw new Error(`unknown player ${id}`);
  }
  return player;
}

export function updatePlayer(
  state: GameState,
  id: PlayerId,
  update: (player: PlayerState) => Partial<PlayerState>,
): GameState {
  return {
    ...state,
    players: state.players.map((p) => (p.id === id ? { ...p, ...update(p) } : p)),
  };
}

export function updateTile(
  state: GameState,
  index: TileIndex,
  patch: Partial<TileState>,
): GameState {
  return {
    ...state,
    tiles: state.tiles.map((t, i) => (i === index ? { ...t, ...patch } : t)),
  };
}
