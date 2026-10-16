// Consistency checks on a GameState, shared by tests, tools/sim and a future server debug mode.
// Total money is deliberately not checked: payouts and bonuses create money (docs/DECISIONS.md).
import { isLinked } from './board';
import { daysBetween, isValidDate, type CalendarDate } from './calendar';
import { VEHICLES } from './config';
import type { AuctionPhase, GameState, PlayerState } from './state';
import { auctionStartPrice, buyPrice, upgradeCost } from './money';
import { isValidProfile } from './profile';

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

const formatDate = ({ year, month, day }: CalendarDate): string =>
  `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

function checkCalendar({ config, day, date, priceIndex, lotteryPool }: GameState): string[] {
  const errors: string[] = [];
  if (!isNonNegativeInteger(lotteryPool)) {
    errors.push(`lotteryPool ${lotteryPool} is not a non-negative integer`);
  }
  if (!isNonNegativeInteger(day)) {
    errors.push(`day ${day} is not a non-negative integer`);
  } else if (!isValidDate(date)) {
    errors.push(`date ${formatDate(date)} is not a valid date`);
  } else if (daysBetween(config.startDate, date) !== day) {
    errors.push(
      `date ${formatDate(date)} is not ${day} days after the start date ${formatDate(config.startDate)}`,
    );
  }
  if (!Number.isSafeInteger(priceIndex) || priceIndex < 1) {
    errors.push(`priceIndex ${priceIndex} is not an integer >= 1`);
  }
  return errors;
}

function checkPlayers(state: GameState): string[] {
  const { board, players, tiles } = state;
  const errors: string[] = [];
  for (const player of players) {
    const { id, cash, deposit, location, vehicle, diceCount, bankrupt } = player;
    if (player.controller === 'computer' && !isValidProfile(player.profile)) {
      errors.push(`player ${id}: a computer without a valid profile`);
    }
    if (!isNonNegativeInteger(cash)) {
      errors.push(`player ${id}: cash ${cash} is not a non-negative integer`);
    }
    if (!isNonNegativeInteger(deposit)) {
      errors.push(`player ${id}: deposit ${deposit} is not a non-negative integer`);
    }
    const { loan, loanDue } = player;
    if (!isNonNegativeInteger(loan)) {
      errors.push(`player ${id}: loan ${loan} is not a non-negative integer`);
    }
    if (loanDue !== null && !isValidDate(loanDue)) {
      errors.push(`player ${id}: loanDue ${formatDate(loanDue)} is not a valid date`);
    } else if (loan > 0 && loanDue === null) {
      errors.push(`player ${id}: loan ${loan} has no due date`);
    }
    // Bankruptcy writes the loan off (docs/GAME_RULES.md §8).
    if (bankrupt && (loan !== 0 || loanDue !== null)) {
      errors.push(`player ${id}: bankrupt but has a loan or a due date`);
    }
    if (!VEHICLES.includes(vehicle)) {
      errors.push(`player ${id}: vehicle ${vehicle} is not a vehicle`);
    } else {
      const most = state.config.vehicleMaxDice[vehicle];
      if (!Number.isInteger(diceCount) || diceCount < 1 || diceCount > most) {
        errors.push(`player ${id}: diceCount ${diceCount} is outside 1..${most} for ${vehicle}`);
      }
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
  // A bankrupt player stays current while their properties are auctioned.
  const mayBeBankrupt = turn.phase.kind === 'gameOver' || turn.phase.kind === 'auction';
  if (!mayBeBankrupt && current?.bankrupt === true) {
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
    case 'awaitRoll': {
      const count = phase.computerDiceCount;
      const prefix = 'phase awaitRoll: computerDiceCount';
      if (count === undefined) break;
      if (current.controller !== 'computer') {
        errors.push(`${prefix} on the turn of ${current.id}, who is not a computer`);
      } else if (current.vehicle === 'walk') {
        errors.push(`${prefix} ${count} while ${current.id} is on foot`);
      } else {
        const most = config.vehicleMaxDice[current.vehicle];
        if (!Number.isInteger(count) || count < 1 || count > most) {
          errors.push(`${prefix} ${count} is outside 1..${most} for ${current.vehicle}`);
        }
      }
      break;
    }
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
    case 'auction':
      errors.push(...checkAuction(state, phase).map((error) => `phase auction: ${error}`));
      break;
    case 'bank': {
      const stands = current.location.kind === 'onBoard' ? current.location.tile : 'off board';
      if (current.controller !== 'human') {
        errors.push(`phase bank: ${current.id} is not a human`);
      }
      if (phase.tile !== stands) {
        errors.push(`phase bank: tile ${phase.tile} is not where ${current.id} stands (${stands})`);
      }
      if (board.tiles[phase.tile]?.kind !== 'bank') {
        errors.push(`phase bank: tile ${phase.tile} is not a bank`);
      }
      const { trigger } = phase;
      if (
        trigger.kind === 'pass' &&
        (!Number.isSafeInteger(trigger.stepsLeft) || trigger.stepsLeft < 1)
      ) {
        errors.push(`phase bank: stepsLeft ${trigger.stepsLeft} is not a positive integer`);
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

function checkAuction(state: GameState, phase: AuctionPhase): string[] {
  const { board, players, tiles } = state;
  const errors: string[] = [];
  const drawn = [phase.tile, ...phase.queue];
  drawn.forEach((tile, i) => {
    if (board.tiles[tile]?.kind !== 'property') {
      errors.push(`tile ${tile} is not a property`);
    } else if (tiles[tile]?.owner != null) {
      errors.push(`tile ${tile} is owned by ${tiles[tile]?.owner}`);
    }
    if (drawn.indexOf(tile) !== i) {
      errors.push(`tile ${tile} is drawn twice`);
    }
  });
  if (board.tiles[phase.tile]?.kind === 'property') {
    const startPrice = auctionStartPrice(state, phase.tile);
    if (phase.startPrice !== startPrice) {
      errors.push(`start price ${phase.startPrice} does not match ${startPrice}`);
    }
  }

  const cashOf = (id: string) => players.find((p) => p.id === id)?.cash ?? 0;
  const { leader, price } = phase;
  if (leader === null) {
    if (price !== phase.startPrice) {
      errors.push(`price ${price} is above the start price without a leader`);
    }
  } else {
    if (price <= phase.startPrice) {
      errors.push(`leader ${leader} but price ${price} is not above the start price`);
    }
    if (cashOf(leader) < price) {
      errors.push(`leader ${leader} has less cash than the price ${price}`);
    }
  }

  const seat = (id: string) => players.findIndex((p) => p.id === id);
  const seats = phase.bidders.map((b) => seat(b.id));
  if (seats.some((s, i) => i > 0 && s <= (seats[i - 1] ?? -1))) {
    errors.push('bidders are not in seat order');
  }
  for (const { id } of phase.bidders) {
    const player = players.find((p) => p.id === id);
    if (player === undefined) {
      errors.push(`bidder ${id} is not a player`);
    } else if (player.bankrupt) {
      errors.push(`bidder ${id} is bankrupt`);
    }
  }

  const computers = new Set(
    phase.bidders.flatMap(({ id }) =>
      players.find((p) => p.id === id)?.controller === 'computer' ? [id] : [],
    ),
  );
  for (const id of computers) {
    if (!(id in phase.computerLimits)) {
      errors.push(`computer bidder ${id} has no limit`);
    }
  }
  for (const [id, limit] of Object.entries(phase.computerLimits)) {
    if (!computers.has(id)) {
      errors.push(`${id} has a computer limit but is not a computer bidder`);
    } else if (!isNonNegativeInteger(limit)) {
      errors.push(`computer limit ${limit} of ${id} is not a non-negative integer`);
    }
  }

  const bidder = phase.bidders.find((b) => b.id === phase.bidder);
  if (bidder === undefined) {
    errors.push(`bidder ${phase.bidder} is not a bidder`);
  } else if (bidder.status === 'withdrawn') {
    errors.push(`bidder ${phase.bidder} has withdrawn`);
  } else if (phase.bidder === leader) {
    errors.push(`bidder ${phase.bidder} is the leader`);
  } else if (cashOf(phase.bidder) < price) {
    errors.push(`bidder ${phase.bidder} has less cash than the price ${price}`);
  }
  return errors;
}
