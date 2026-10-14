import { describe, expect, it } from 'vitest';
import { checkInvariants } from './invariants';
import type { GameState, Phase } from './state';
import { loopBoard, newTestGame, patchPlayer, patchTile, patchTurn, placePlayer } from './testing';

/** Tiles 0 and 3 are blank; tile 1 costs 1000 (upgrade 500 at the default 50%), tile 2 costs 2000. */
const BOARD = loopBoard([null, 1000, 2000, null]);

/** Two players on BOARD; p1 is current and waiting to roll. */
const base = (): GameState => newTestGame({ board: BOARD });

/** p1 standing on tile 1 while the game waits for `phase`. */
const deciding = (phase: Phase): GameState => patchTurn(placePlayer(base(), 'p1', 1), { phase });

const buy = (patch: Partial<{ tile: number; price: number }> = {}): Phase => ({
  kind: 'awaitBuyDecision',
  tile: 1,
  price: 1000,
  ...patch,
});

const upgrade = (patch: Partial<{ tile: number; cost: number }> = {}): Phase => ({
  kind: 'awaitUpgradeDecision',
  tile: 1,
  cost: 500,
  ...patch,
});

describe('checkInvariants', () => {
  it('accepts freshly created games', () => {
    expect(checkInvariants(base())).toEqual([]);
    expect(checkInvariants(newTestGame({ playerCount: 4 }))).toEqual([]);
    // Seats after the current player wait off the board during round 1.
    const placing = newTestGame({ playerCount: 4, placement: 'engine' });
    expect(checkInvariants(placing)).toEqual([]);
    expect(checkInvariants(patchTurn(placing, { current: 'p2' }))).toContain(
      'player p2: off the board after their first turn started',
    );
  });

  it('accepts consistent decision and game-over phases', () => {
    expect(checkInvariants(deciding(buy()))).toEqual([]);
    expect(checkInvariants(patchTile(deciding(upgrade()), 1, { owner: 'p1', level: 4 }))).toEqual(
      [],
    );
    const over = patchTurn(patchPlayer(base(), 'p1', { bankrupt: true, cash: 0, deposit: 0 }), {
      phase: { kind: 'gameOver', winners: ['p2'] },
    });
    expect(checkInvariants(over)).toEqual([]);
  });

  const cases: [string, () => GameState, string][] = [
    [
      'negative cash',
      () => patchPlayer(base(), 'p1', { cash: -1 }),
      'player p1: cash -1 is not a non-negative integer',
    ],
    [
      'fractional cash',
      () => patchPlayer(base(), 'p2', { cash: 1.5 }),
      'player p2: cash 1.5 is not a non-negative integer',
    ],
    [
      'negative deposit',
      () => patchPlayer(base(), 'p1', { deposit: -5 }),
      'player p1: deposit -5 is not a non-negative integer',
    ],
    [
      'tile off the board',
      () => placePlayer(base(), 'p2', 4, 3),
      'player p2: tile 4 is not on the board',
    ],
    [
      'prev not a neighbour of tile',
      () => placePlayer(base(), 'p1', 0, 2),
      'player p1: prev 2 is not a neighbour of tile 0',
    ],
    [
      'current player off the board',
      () => patchPlayer(base(), 'p1', { location: { kind: 'offBoard' } }),
      'player p1: off the board after their first turn started',
    ],
    [
      'earlier seat off the board',
      () =>
        patchTurn(patchPlayer(base(), 'p1', { location: { kind: 'offBoard' } }), {
          current: 'p2',
        }),
      'player p1: off the board after their first turn started',
    ],
    [
      'later seat off the board after round 1',
      () => patchTurn(patchPlayer(base(), 'p2', { location: { kind: 'offBoard' } }), { round: 2 }),
      'player p2: off the board after their first turn started',
    ],
    [
      'bankrupt player owning land',
      () => patchTile(patchPlayer(base(), 'p2', { bankrupt: true }), 1, { owner: 'p2' }),
      'player p2: bankrupt but owns tiles 1',
    ],
    [
      'level above maxLevel',
      () => patchTile(base(), 1, { owner: 'p1', level: 6 }),
      'tile 1: level 6 is outside 0..5',
    ],
    [
      'negative level',
      () => patchTile(base(), 2, { owner: 'p1', level: -1 }),
      'tile 2: level -1 is outside 0..5',
    ],
    [
      'owner that is not a player',
      () => patchTile(base(), 1, { owner: 'ghost' }),
      'tile 1: owner ghost is not a player',
    ],
    [
      'owned non-property tile',
      () => patchTile(base(), 0, { owner: 'p1' }),
      'tile 0: not a property but has owner p1 and level 0',
    ],
    [
      'built non-property tile',
      () => patchTile(base(), 3, { level: 1 }),
      'tile 3: not a property but has owner null and level 1',
    ],
    [
      'unowned property with houses',
      () => patchTile(base(), 1, { level: 2 }),
      'tile 1: unowned but level 2',
    ],
    [
      'tile states not parallel to the board',
      () => ({ ...base(), tiles: base().tiles.slice(1) }),
      'tiles: 3 entries for 4 board tiles',
    ],
    [
      'unknown current player',
      () => patchTurn(base(), { current: 'ghost' }),
      'turn: current ghost is not a player',
    ],
    [
      'round below 1',
      () => patchTurn(base(), { round: 0 }),
      'turn: round 0 is not a positive integer',
    ],
    [
      'round beyond maxRounds',
      () =>
        patchTurn(
          newTestGame({
            board: BOARD,
            config: { winCondition: 'richestAtRoundLimit', maxRounds: 3 },
          }),
          { round: 4 },
        ),
      'turn: round 4 exceeds maxRounds 3',
    ],
    [
      'bankrupt current player before the game is over',
      () => patchPlayer(base(), 'p1', { bankrupt: true }),
      'turn: current player p1 is bankrupt',
    ],
    [
      'buy decision away from the current player',
      () => patchTurn(base(), { phase: buy() }),
      'phase awaitBuyDecision: tile 1 is not where p1 stands (0)',
    ],
    [
      'buy decision on a blank tile',
      () => patchTurn(base(), { phase: buy({ tile: 0 }) }),
      'phase awaitBuyDecision: tile 0 is not a property',
    ],
    [
      'buy decision at the wrong price',
      () => deciding(buy({ price: 999 })),
      'phase awaitBuyDecision: price 999 does not match buy price 1000',
    ],
    [
      'buy decision on owned land',
      () => patchTile(deciding(buy()), 1, { owner: 'p2' }),
      'phase awaitBuyDecision: tile 1 is already owned by p2',
    ],
    [
      'upgrade decision away from the current player',
      () => patchTile(patchTurn(base(), { phase: upgrade() }), 1, { owner: 'p1' }),
      'phase awaitUpgradeDecision: tile 1 is not where p1 stands (0)',
    ],
    [
      'upgrade decision on a blank tile',
      () => patchTurn(base(), { phase: upgrade({ tile: 0 }) }),
      'phase awaitUpgradeDecision: tile 0 is not a property',
    ],
    [
      "upgrade decision on someone else's land",
      () => patchTile(deciding(upgrade()), 1, { owner: 'p2' }),
      'phase awaitUpgradeDecision: tile 1 is owned by p2, not p1',
    ],
    [
      'upgrade decision on unowned land',
      () => deciding(upgrade()),
      'phase awaitUpgradeDecision: tile 1 is owned by nobody, not p1',
    ],
    [
      'upgrade decision at maxLevel',
      () => patchTile(deciding(upgrade()), 1, { owner: 'p1', level: 5 }),
      'phase awaitUpgradeDecision: tile 1 is already at maxLevel 5',
    ],
    [
      'upgrade decision at the wrong cost',
      () => patchTile(deciding(upgrade({ cost: 1 })), 1, { owner: 'p1' }),
      'phase awaitUpgradeDecision: cost 1 does not match upgrade cost 500',
    ],
    [
      'bankrupt winner',
      () =>
        patchTurn(patchPlayer(base(), 'p2', { bankrupt: true }), {
          phase: { kind: 'gameOver', winners: ['p2'] },
        }),
      'phase gameOver: winner p2 is bankrupt',
    ],
    [
      'winner that is not a player',
      () => patchTurn(base(), { phase: { kind: 'gameOver', winners: ['ghost'] } }),
      'phase gameOver: winner ghost is not a player',
    ],
  ];

  it.each(cases)('reports %s', (_, build, message) => {
    expect(checkInvariants(build())).toEqual([message]);
  });

  it('reports every violation at once', () => {
    let state = patchPlayer(base(), 'p1', { cash: -1, deposit: -2 });
    state = patchTile(state, 1, { level: 3 });
    state = patchTurn(state, { round: 0 });
    expect(checkInvariants(state)).toEqual([
      'player p1: cash -1 is not a non-negative integer',
      'player p1: deposit -2 is not a non-negative integer',
      'tile 1: unowned but level 3',
      'turn: round 0 is not a positive integer',
    ]);
  });
});
