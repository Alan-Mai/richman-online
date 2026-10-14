// Consistency checks on a GameState, shared by tests, tools/sim and a future server debug mode.
// Total money is deliberately not checked: payouts and bonuses create money (docs/DECISIONS.md).
import { isLinked } from './board';
import type { GameState, PlayerState } from './state';
import { buyPrice, upgradeCost } from './money';

function isNonNegativeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

/** Every violated invariant as one line of text; an empty array means the state is consistent. */
export function checkInvariants(state: GameState): string[] {
  return [
    ...checkCalendar(state),
    ...checkPlayers(state),
    ...checkTiles(state),
    ...checkTurn(state),
  ];
}

function checkCalendar({ day, priceIndex }: GameState): string[] {
  const errors: string[] = [];
  if (!isNonNegativeInteger(day)) {
    errors.push(`day ${day} is not a non-negative integer`);
  }
  if (!Number.isSafeInteger(priceIndex) || priceIndex < 1) {
    errors.push(`priceIndex ${priceIndex} is not an integer >= 1`);
  }
  return errors;
}

function checkPlayers(state: GameState): string[] {
  const { board, players, tiles } = state;
  const errors: string[] = [];
  for (const { id, cash, deposit, location, bankrupt } of players) {
    if (!isNonNegativeInteger(cash)) {
      errors.push(`player ${id}: cash ${cash} is not a non-negative integer`);
    }
    if (!isNonNegativeInteger(deposit)) {
      errors.push(`player ${id}: deposit ${deposit} is not a non-negative integer`);
    }
    if (location.kind === 'onBoard') {
      const { tile, prev } = location;
      if (!Number.isInteger(tile) || tile < 0 || tile >= board.tiles.length) {
        errors.push(`player ${id}: tile ${tile} is not on the board`);
      } else if (!isLinked(board, tile, prev)) {
        errors.push(`player ${id}: prev ${prev} is not a neighbour of tile ${tile}`);
      }
    } else if (!mayBeOffBoard(state, id)) {
      errors.push(`player ${id}: off the board after their first turn started`);
    }
    const owned = tiles.flatMap((tile, i) => (tile.owner === id ? [i] : []));
    if (bankrupt && owned.length > 0) {
      errors.push(`player ${id}: bankrupt but owns tiles ${owned.join(', ')}`);
    }
  }
  return errors;
}

/** Only players whose first turn has not started yet: round 1, seated after the current player. */
function mayBeOffBoard(state: GameState, id: string): boolean {
  const seat = (playerId: string) => state.players.findIndex((p) => p.id === playerId);
  return state.turn.round === 1 && seat(id) > seat(state.turn.current);
}

function checkTiles({ config, board, players, tiles }: GameState): string[] {
  const errors: string[] = [];
  if (tiles.length !== board.tiles.length) {
    errors.push(`tiles: ${tiles.length} entries for ${board.tiles.length} board tiles`);
  }
  const ids = new Set(players.map((p) => p.id));
  tiles.forEach(({ owner, level }, i) => {
    if (!Number.isInteger(level) || level < 0 || level > config.maxLevel) {
      errors.push(`tile ${i}: level ${level} is outside 0..${config.maxLevel}`);
    }
    if (owner !== null && !ids.has(owner)) {
      errors.push(`tile ${i}: owner ${owner} is not a player`);
    }
    // Unowned properties may have buildings: a bankruptcy releases tiles with them.
    if (board.tiles[i]?.kind !== 'property' && (owner !== null || level !== 0)) {
      errors.push(`tile ${i}: not a property but has owner ${owner} and level ${level}`);
    }
  });
  return errors;
}

function checkTurn(state: GameState): string[] {
  const { players, turn } = state;
  const errors: string[] = [];
  const current = players.find((p) => p.id === turn.current);
  if (current === undefined) {
    errors.push(`turn: current ${turn.current} is not a player`);
  }
  if (!Number.isSafeInteger(turn.round) || turn.round < 1) {
    errors.push(`turn: round ${turn.round} is not a positive integer`);
  }
  if (turn.phase.kind !== 'gameOver' && current?.bankrupt === true) {
    errors.push(`turn: current player ${current.id} is bankrupt`);
  }
  if (current !== undefined) {
    errors.push(...checkPhase(state, current));
  }
  return errors;
}

function checkPhase(state: GameState, current: PlayerState): string[] {
  const { config, board, players, tiles } = state;
  const { phase } = state.turn;
  const errors: string[] = [];
  switch (phase.kind) {
    case 'awaitRoll':
      break;
    case 'awaitBuyDecision':
    case 'awaitUpgradeDecision': {
      const prefix = `phase ${phase.kind}: `;
      const stands = current.location.kind === 'onBoard' ? current.location.tile : 'off board';
      if (phase.tile !== stands) {
        errors.push(`${prefix}tile ${phase.tile} is not where ${current.id} stands (${stands})`);
      }
      const def = board.tiles[phase.tile];
      if (def?.kind !== 'property') {
        errors.push(`${prefix}tile ${phase.tile} is not a property`);
        break;
      }
      const owner = tiles[phase.tile]?.owner ?? null;
      const level = tiles[phase.tile]?.level ?? 0;
      if (phase.kind === 'awaitBuyDecision') {
        const price = buyPrice(state, phase.tile);
        if (phase.price !== price) {
          errors.push(`${prefix}price ${phase.price} does not match buy price ${price}`);
        }
        if (owner !== null) {
          errors.push(`${prefix}tile ${phase.tile} is already owned by ${owner}`);
        }
      } else {
        if (owner !== current.id) {
          errors.push(
            `${prefix}tile ${phase.tile} is owned by ${owner ?? 'nobody'}, not ${current.id}`,
          );
        }
        if (level >= config.maxLevel) {
          errors.push(`${prefix}tile ${phase.tile} is already at maxLevel ${config.maxLevel}`);
        }
        const cost = upgradeCost(state, phase.tile);
        if (phase.cost !== cost) {
          errors.push(`${prefix}cost ${phase.cost} does not match upgrade cost ${cost}`);
        }
      }
      break;
    }
    case 'gameOver':
      for (const winner of phase.winners) {
        const player = players.find((p) => p.id === winner);
        if (player === undefined) {
          errors.push(`phase gameOver: winner ${winner} is not a player`);
        } else if (player.bankrupt) {
          errors.push(`phase gameOver: winner ${winner} is bankrupt`);
        }
      }
      break;
  }
  return errors;
}
