import {
  DEFAULT_RULE_CONFIG,
  TEST_BRANCH_BOARD,
  TEST_LOOP_BOARD,
  createGame,
} from '@richman/shared';
import { describe, expect, it } from 'vitest';
import { buildSetup, defaultSetupForm, describeSetupError, type SetupForm } from './setup-form';

const fixedSeed = () => 1234;

function form(patch: Partial<SetupForm> = {}): SetupForm {
  return { ...defaultSetupForm(), ...patch };
}

function ok(f: SetupForm) {
  const result = buildSetup(f, fixedSeed);
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.setup;
}

describe('buildSetup', () => {
  it('turns the default form into a setup createGame accepts', () => {
    const setup = ok(form());
    expect(setup.players).toHaveLength(DEFAULT_RULE_CONFIG.maxPlayers);
    expect(setup.config.winCondition).toBe('richestAtRoundLimit');
    expect(setup.config.maxRounds).toBe(20);
    expect(setup.seed).toBe(1234);
    expect(createGame(setup).ok).toBe(true);
  });

  it('plays the chosen built-in board, the loop by default', () => {
    expect(ok(form()).board).toBe(TEST_LOOP_BOARD);
    const branch = ok(form({ board: 'test-branch' }));
    expect(branch.board).toBe(TEST_BRANCH_BOARD);
    expect(createGame(branch).ok).toBe(true);
  });

  it('uses as many seats as the player count', () => {
    const setup = ok(form({ playerCount: 2 }));
    expect(setup.players.map((p) => p.id)).toEqual(['p1', 'p2']);
  });

  it('trims names, cuts them to the limit and fills blanks with defaults', () => {
    const setup = ok(form({ names: ['  阿土伯  ', '', '一二三四五六七八九十甲乙丙', '孫小美'] }));
    expect(setup.players.map((p) => p.name)).toEqual([
      '阿土伯',
      '玩家 2',
      '一二三四五六七八九十甲乙',
      '孫小美',
    ]);
  });

  it('rejects duplicate names among the playing seats only', () => {
    const result = buildSetup(form({ names: ['甲', '乙', '甲', '丁'] }), fixedSeed);
    expect(result).toEqual({
      ok: false,
      errors: [{ field: 'name', seat: 2, reason: 'duplicate' }],
    });
    expect(
      buildSetup(form({ playerCount: 2, names: ['甲', '乙', '甲', '甲'] }), fixedSeed).ok,
    ).toBe(true);
  });

  it('needs a round limit only for the round-limit condition', () => {
    expect(buildSetup(form({ maxRounds: '0' }), fixedSeed)).toMatchObject({
      ok: false,
      errors: [{ field: 'maxRounds' }],
    });
    const setup = ok(form({ winCondition: 'lastStanding', maxRounds: 'x' }));
    expect(setup.config.maxRounds).toBeNull();
    expect(createGame(setup).ok).toBe(true);
  });

  it('accepts starting money with thousands separators and rejects anything else', () => {
    const setup = ok(form({ startingFunds: '3,001' }));
    expect(setup.config.startingFunds).toBe(3001);
    for (const bad of ['0', '-1', '1.5', 'abc', '']) {
      expect(buildSetup(form({ startingFunds: bad }), fixedSeed)).toMatchObject({
        ok: false,
        errors: [{ field: 'startingFunds' }],
      });
    }
  });

  it('uses a typed seed, or a random one when blank', () => {
    expect(ok(form({ seed: ' 42 ' })).seed).toBe(42);
    expect(ok(form({ seed: '4294967295' })).seed).toBe(4294967295);
    expect(buildSetup(form({ seed: '4294967296' }), fixedSeed)).toMatchObject({
      ok: false,
      errors: [{ field: 'seed' }],
    });
    expect(ok(form({ seed: '' })).seed).toBe(1234);
  });

  it('reports every problem at once', () => {
    const result = buildSetup(
      form({ names: ['甲', '甲'], maxRounds: '', startingFunds: 'x', seed: '-3' }),
      fixedSeed,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.map((e) => e.field)).toEqual([
        'name',
        'maxRounds',
        'startingFunds',
        'seed',
      ]);
    }
  });
});

describe('describeSetupError', () => {
  it('names the duplicate and the field', () => {
    const f = form({ names: ['甲', '甲'] });
    expect(describeSetupError({ field: 'name', seat: 1, reason: 'duplicate' }, f)).toBe(
      '玩家名稱不可重複：甲',
    );
    expect(describeSetupError({ field: 'startingFunds', reason: 'invalid' }, f)).toBe(
      '起始資金必須是 1 以上的整數',
    );
  });
});
