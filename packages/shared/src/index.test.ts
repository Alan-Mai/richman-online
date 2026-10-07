import { describe, expect, it } from 'vitest';
import { ENGINE_VERSION } from './index';

describe('shared', () => {
  it('exposes an engine version', () => {
    expect(ENGINE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
