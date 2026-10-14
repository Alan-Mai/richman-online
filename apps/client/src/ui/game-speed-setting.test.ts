import { describe, expect, it } from 'vitest';
import { DEFAULT_GAME_SPEED } from '../render/timings';
import { loadGameSpeed, saveGameSpeed } from './game-speed-setting';

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (key) => void data.delete(key),
    setItem: (key, value) => void data.set(key, value),
  };
}

describe('game speed setting', () => {
  it('defaults when nothing is stored', () => {
    expect(loadGameSpeed(memoryStorage())).toBe(DEFAULT_GAME_SPEED);
    expect(loadGameSpeed(null)).toBe(DEFAULT_GAME_SPEED);
  });

  it('remembers a saved speed', () => {
    const storage = memoryStorage();
    saveGameSpeed(0, storage);
    expect(loadGameSpeed(storage)).toBe(0);
  });

  it('ignores invalid stored values', () => {
    const storage = memoryStorage();
    storage.setItem('richman.gameSpeed', '7');
    expect(loadGameSpeed(storage)).toBe(DEFAULT_GAME_SPEED);
    storage.setItem('richman.gameSpeed', '');
    expect(loadGameSpeed(storage)).toBe(DEFAULT_GAME_SPEED);
  });

  it('survives storage that throws', () => {
    const broken = memoryStorage();
    broken.getItem = () => {
      throw new Error('blocked');
    };
    broken.setItem = () => {
      throw new Error('blocked');
    };
    expect(() => saveGameSpeed(1, broken)).not.toThrow();
    expect(loadGameSpeed(broken)).toBe(DEFAULT_GAME_SPEED);
  });
});
