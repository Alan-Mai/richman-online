// The player's own game speed, kept in browser storage. Storage may be missing or throw (private
// windows, blocked site data); the default speed is used then.
import { DEFAULT_GAME_SPEED, isGameSpeed, type GameSpeed } from '../render/timings';

const KEY = 'richman.gameSpeed';

function defaultStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function loadGameSpeed(storage: Storage | null = defaultStorage()): GameSpeed {
  try {
    const stored = storage?.getItem(KEY);
    const value = stored == null || stored === '' ? NaN : Number(stored);
    return isGameSpeed(value) ? value : DEFAULT_GAME_SPEED;
  } catch {
    return DEFAULT_GAME_SPEED;
  }
}

export function saveGameSpeed(speed: GameSpeed, storage: Storage | null = defaultStorage()): void {
  try {
    storage?.setItem(KEY, String(speed));
  } catch {
    // Not remembered; the setting still applies to this session.
  }
}
