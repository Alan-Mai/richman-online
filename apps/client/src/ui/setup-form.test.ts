import {
  DEFAULT_RULE_CONFIG,
  PROVISIONAL_COMPUTER_PROFILE,
  TEST_BRANCH_BOARD,
  TEST_LOOP_BOARD,
  createGame,
  drawCharacters,
} from '@richman/shared';
import { describe, expect, it } from 'vitest';
import {
  buildSetup,
  defaultSetupForm,
  describeSetupError,
  formAfterGame,
  previewCharacters,
  tierLabels,
  type SetupForm,
} from './setup-form';

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
    // The original default: no day limit, no net worth target.
    expect(setup.config.dayLimit).toBeNull();
    expect(setup.config.netWorthTargetMultiple).toBeNull();
    expect(setup.seed).toBe(1234);
    expect(createGame(setup).ok).toBe(true);
  });

  it('plays the chosen built-in board, the loop by default', () => {
    expect(ok(form()).board).toBe(TEST_LOOP_BOARD);
    const branch = ok(form({ board: 'test-branch' }));
    expect(branch.board).toBe(TEST_BRANCH_BOARD);
    expect(createGame(branch).ok).toBe(true);
  });

  it('gives computers the provisional profile without tables', () => {
    const result = buildSetup(form({ controllers: ['human', 'computer'] }), fixedSeed);
    if (!result.ok) throw new Error('expected ok');
    expect(result.setup.players[1]).toMatchObject({ profile: PROVISIONAL_COMPUTER_PROFILE });
    expect(result.characters).toEqual({});
  });

  it('draws different characters from the tables for computers, by the seed', () => {
    // Made-up profiles, told apart by their cash share.
    const characters = Array.from({ length: 12 }, (_, i) => ({
      cashPercent: i + 1,
      loanPercent: 50,
    }));
    const values = form({ controllers: ['human', 'computer', 'computer', 'computer'] });
    const result = buildSetup(values, fixedSeed, characters);
    if (!result.ok) throw new Error('expected ok');
    const drawn = drawCharacters(12, 3, 1234);
    expect(result.characters).toEqual({ p2: drawn[0]! + 1, p3: drawn[1]! + 1, p4: drawn[2]! + 1 });
    expect(
      result.setup.players.slice(1).map((p) => p.controller === 'computer' && p.profile),
    ).toEqual(drawn.map((i) => characters[i]));
    expect(createGame(result.setup).ok).toBe(true);
  });

  it('previews the characters for a typed seed, and nothing for a blank one', () => {
    const values = form({ controllers: ['human', 'computer', 'computer'], seed: '1234' });
    const drawn = drawCharacters(12, 2, 1234);
    expect(previewCharacters(values, 12)).toEqual([null, drawn[0]! + 1, drawn[1]! + 1, null]);
    expect(previewCharacters({ ...values, seed: '' }, 12)).toBeNull();
    expect(previewCharacters({ ...values, seed: 'x' }, 12)).toBeNull();
  });

  it('seats humans by default and computers where chosen', () => {
    expect(ok(form()).players.map((p) => p.controller)).toEqual([
      'human',
      'human',
      'human',
      'human',
    ]);
    const setup = ok(form({ controllers: ['human', 'computer', 'human', 'computer'] }));
    expect(setup.players.map((p) => p.controller)).toEqual([
      'human',
      'computer',
      'human',
      'computer',
    ]);
    expect(createGame(setup).ok).toBe(true);
  });

  it('starts everyone on foot by default, or on the chosen vehicle', () => {
    expect(ok(form()).config.startingVehicle).toBe('walk');
    for (const vehicle of ['motorbike', 'car'] as const) {
      const setup = ok(form({ vehicle }));
      expect(setup.config.startingVehicle).toBe(vehicle);
      expect(createGame(setup).ok).toBe(true);
    }
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

  it('takes a net worth target as a multiple, or none when blank', () => {
    for (const bad of ['0', '1000', 'x', '2.5']) {
      expect(buildSetup(form({ netWorthTarget: bad }), fixedSeed)).toMatchObject({
        ok: false,
        errors: [{ field: 'netWorthTarget' }],
      });
    }
    expect(ok(form({ netWorthTarget: '3' })).config.netWorthTargetMultiple).toBe(3);
    expect(ok(form({ netWorthTarget: '' })).config.netWorthTargetMultiple).toBeNull();
    expect(describeSetupError({ field: 'netWorthTarget', reason: 'invalid' }, form())).toBe(
      '淨值目標必須是 1 到 999 的整數，或留空表示無目標',
    );
  });

  it('takes a day limit, or none when blank', () => {
    for (const bad of ['0', '10000', 'x', '1.5']) {
      expect(buildSetup(form({ dayLimit: bad }), fixedSeed)).toMatchObject({
        ok: false,
        errors: [{ field: 'dayLimit' }],
      });
    }
    expect(ok(form({ dayLimit: ' 30 ' })).config.dayLimit).toBe(30);
    expect(ok(form({ dayLimit: '9999' })).config.dayLimit).toBe(9999);
    const setup = ok(form({ dayLimit: '  ' }));
    expect(setup.config.dayLimit).toBeNull();
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
      form({ names: ['甲', '甲'], dayLimit: '0', startingFunds: 'x', seed: '-3' }),
      fixedSeed,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.map((e) => e.field)).toEqual([
        'name',
        'dayLimit',
        'startingFunds',
        'seed',
      ]);
    }
  });
});

// Invented option tables (not the original values); index 3 of the target list is a stray 0.
const OPTIONS = {
  startingFunds: [1137, 2213, 3391, 4409, 5521, 6673],
  dayLimit: [0, 13, 27, 41, 59, 73],
  netWorthTargetMultiple: [0, 17, 19, 0, 23, 29],
  dayLimitLabels: ['a', 'b', 'c', 'd', 'e', 'f'],
};

describe('buildSetup with the original option tables', () => {
  const tiered = (f: SetupForm) => buildSetup(f, fixedSeed, null, OPTIONS);

  it('starts from the original default options: second starting funds, no limits', () => {
    expect(defaultSetupForm().tiers).toEqual({ startingFunds: 1, dayLimit: 0, netWorthTarget: 0 });
    const result = tiered(form());
    expect(result.ok && result.setup.config).toMatchObject({
      startingFunds: 2213,
      dayLimit: null,
      netWorthTargetMultiple: null,
    });
  });

  it('takes each setting from the chosen option, a 0 option meaning no limit', () => {
    const result = tiered(form({ tiers: { startingFunds: 4, dayLimit: 2, netWorthTarget: 5 } }));
    expect(result.ok && result.setup.config).toMatchObject({
      startingFunds: 5521,
      dayLimit: 27,
      netWorthTargetMultiple: 29,
    });
    if (result.ok) expect(createGame(result.setup).ok).toBe(true);
    const stray = tiered(form({ tiers: { startingFunds: 0, dayLimit: 0, netWorthTarget: 3 } }));
    expect(stray.ok && stray.setup.config.netWorthTargetMultiple).toBeNull();
  });

  it('ignores the custom fields, even invalid ones', () => {
    const result = tiered(form({ dayLimit: 'x', netWorthTarget: '0', startingFunds: '' }));
    expect(result.ok).toBe(true);
  });

  it('treats an option index outside 0-5 as a caller bug', () => {
    expect(() =>
      tiered(form({ tiers: { startingFunds: 6, dayLimit: 0, netWorthTarget: 0 } })),
    ).toThrow();
    expect(() =>
      tiered(form({ tiers: { startingFunds: 1, dayLimit: 1.5, netWorthTarget: 0 } })),
    ).toThrow();
  });
});

describe('formAfterGame', () => {
  const chosen = { startingFunds: 4, dayLimit: 2, netWorthTarget: 5 };
  const played = (controllers: SetupForm['controllers']) => form({ controllers, tiers: chosen });
  const setupOf = (f: SetupForm) => ok(f);

  it('keeps the whole form when the only human seat won, as the original goes on to the next game', () => {
    const f = {
      ...played(['human', 'computer', 'computer']),
      playerCount: 3,
      vehicle: 'car' as const,
    };
    expect(formAfterGame(f, setupOf(f), ['p1'])).toEqual(f);
  });

  it('goes back to the default options otherwise, as the original returns to the title', () => {
    const solo = played(['human', 'computer', 'computer', 'computer']);
    // A computer won, or the only human went bankrupt with no winner.
    expect(formAfterGame(solo, setupOf(solo), ['p3']).tiers).toEqual({
      startingFunds: 1,
      dayLimit: 0,
      netWorthTarget: 0,
    });
    expect(formAfterGame(solo, setupOf(solo), []).tiers).toEqual({
      startingFunds: 1,
      dayLimit: 0,
      netWorthTarget: 0,
    });
    // Several human seats: back to the title even when a human won (either of them).
    const hotSeat = played(['human', 'human', 'computer', 'computer']);
    for (const winner of ['p1', 'p2']) {
      expect(formAfterGame(hotSeat, setupOf(hotSeat), [winner]).tiers).toEqual({
        startingFunds: 1,
        dayLimit: 0,
        netWorthTarget: 0,
      });
    }
  });

  it('resets the original settings and keeps the project-only fields when going back', () => {
    const f = {
      ...played(['human', 'human', 'computer']),
      playerCount: 3,
      vehicle: 'motorbike' as const,
      board: 'test-branch' as const,
      names: ['甲', '乙', '丙', '丁'],
      dayLimit: '45',
      netWorthTarget: '6',
      startingFunds: '3000',
      seed: '7',
    };
    const after = formAfterGame(f, setupOf(f), ['p1']);
    // Player count, starting vehicle, seats and options: the original's defaults.
    expect(after).toEqual({
      ...f,
      playerCount: 4,
      vehicle: 'walk',
      controllers: ['human', 'human', 'human', 'human'],
      tiers: { startingFunds: 1, dayLimit: 0, netWorthTarget: 0 },
    });
  });
});

describe('tierLabels', () => {
  it('shows starting funds as plain numbers and the target as an amount of the chosen funds', () => {
    expect(tierLabels(OPTIONS, 1)).toEqual({
      startingFunds: ['1137', '2213', '3391', '4409', '5521', '6673'],
      dayLimit: ['a', 'b', 'c', 'd', 'e', 'f'],
      netWorthTarget: ['無', '37621', '42047', '無', '50899', '64177'],
    });
    expect(tierLabels(OPTIONS, 5).netWorthTarget).toEqual([
      '無',
      '113441',
      '126787',
      '無',
      '153479',
      '193517',
    ]);
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
