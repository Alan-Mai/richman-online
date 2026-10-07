import { ENGINE_VERSION } from '@richman/shared';
import { describe, expect, it } from 'vitest';

describe('workspace link', () => {
  it('resolves @richman/shared', () => {
    expect(ENGINE_VERSION).toBeTypeOf('string');
  });
});
