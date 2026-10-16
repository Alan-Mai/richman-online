// What the screen currently shows. It advances one GameEvent at a time while animations play and
// is checked against the authoritative PlayerView once a batch of events has been played.
import type {
  AuctionBidder,
  CalendarDate,
  GameEvent,
  PlayerId,
  PlayerView,
  TileIndex,
  Vehicle,
} from '@richman/shared';

export interface DisplayPlayer {
  id: PlayerId;
  name: string;
  cash: number;
  deposit: number;
  loan: number;
  loanDue: CalendarDate | null;
  /** null until the player is placed on their first turn. */
  tile: TileIndex | null;
  vehicle: Vehicle;
  /** Dice the next roll uses. */
  diceCount: number;
  bankrupt: boolean;
}

export interface DisplayTile {
  owner: PlayerId | null;
  level: number;
}

/**
 * The auction on screen. Whose turn it is to bid is not here: events do not say it, so the HUD
 * reads it from the latest view once everything has played.
 */
export interface DisplayAuction {
  tile: TileIndex;
  startPrice: number;
  price: number;
  leader: PlayerId | null;
  bidders: readonly AuctionBidder[];
  /** Drawn properties still to be auctioned after this one. */
  remaining: number;
}

export interface DisplayModel {
  round: number;
  /** Days gone by (GameState.day). */
  day: number;
  /** Today's calendar date. */
  date: CalendarDate;
  priceIndex: number;
  current: PlayerId;
  players: readonly DisplayPlayer[];
  tiles: readonly DisplayTile[];
  /** null outside auctions. */
  auction: DisplayAuction | null;
  /** null until the game ends. */
  winners: readonly PlayerId[] | null;
}

export function displayFromView(view: PlayerView): DisplayModel {
  const { phase } = view.turn;
  return {
    round: view.turn.round,
    day: view.day,
    date: { ...view.date },
    priceIndex: view.priceIndex,
    current: view.turn.current,
    players: view.players.map(
      ({ id, name, cash, deposit, loan, loanDue, location, vehicle, diceCount, bankrupt }) => ({
        id,
        name,
        cash,
        deposit,
        loan,
        loanDue: loanDue === null ? null : { ...loanDue },
        tile: location.kind === 'onBoard' ? location.tile : null,
        vehicle,
        diceCount,
        bankrupt,
      }),
    ),
    tiles: view.tiles.map(({ owner, level }) => ({ owner, level })),
    auction:
      phase.kind === 'auction'
        ? {
            tile: phase.tile,
            startPrice: phase.startPrice,
            price: phase.price,
            leader: phase.leader,
            bidders: phase.bidders.map((b) => ({ ...b })),
            remaining: phase.remaining,
          }
        : null,
    winners: phase.kind === 'gameOver' ? [...phase.winners] : null,
  };
}

function updateAuction(
  model: DisplayModel,
  update: (auction: DisplayAuction) => Partial<DisplayAuction>,
): DisplayModel {
  const { auction } = model;
  return auction === null ? model : { ...model, auction: { ...auction, ...update(auction) } };
}

function setBidderStatus(
  model: DisplayModel,
  id: PlayerId,
  status: AuctionBidder['status'],
): DisplayModel {
  return updateAuction(model, (a) => ({
    bidders: a.bidders.map((b) => (b.id === id ? { ...b, status } : b)),
  }));
}

function updatePlayer(
  model: DisplayModel,
  id: PlayerId,
  update: (p: DisplayPlayer) => Partial<DisplayPlayer>,
): DisplayModel {
  return {
    ...model,
    players: model.players.map((p) => (p.id === id ? { ...p, ...update(p) } : p)),
  };
}

function updateTile(model: DisplayModel, index: TileIndex, tile: DisplayTile): DisplayModel {
  return { ...model, tiles: model.tiles.map((t, i) => (i === index ? tile : t)) };
}

/**
 * Applies one event. Payments arrive as DepositWithdrawn (deposit moves to cash) followed by the
 * payment itself (cash goes out), which nets to the engine's cash-then-deposit withdrawal.
 */
export function applyEventToDisplay(model: DisplayModel, event: GameEvent): DisplayModel {
  switch (event.type) {
    case 'TurnStarted':
      return { ...model, current: event.playerId, round: event.round };
    case 'DayAdvanced':
      return { ...model, day: event.day, date: { ...event.date }, priceIndex: event.priceIndex };
    case 'DiceCountSet':
      return updatePlayer(model, event.playerId, () => ({ diceCount: event.count }));
    case 'DiceRolled':
      return model;
    case 'PlayerMoved': {
      const last = event.path.at(-1);
      return last === undefined
        ? model
        : updatePlayer(model, event.playerId, () => ({ tile: last }));
    }
    case 'PlayerPlaced':
      return updatePlayer(model, event.playerId, () => ({ tile: event.tile }));
    case 'DepositWithdrawn':
      return updatePlayer(model, event.playerId, (p) => ({
        cash: p.cash + event.amount,
        deposit: p.deposit - event.amount,
      }));
    case 'BankOpened':
      return model;
    case 'BankRebalanced':
      return updatePlayer(model, event.playerId, () => ({
        cash: event.cash,
        deposit: event.deposit,
      }));
    case 'BankTransferred': {
      const moved = event.direction === 'withdraw' ? event.amount : -event.amount;
      return updatePlayer(model, event.playerId, (p) => ({
        cash: p.cash + moved,
        deposit: p.deposit - moved,
      }));
    }
    case 'PropertyBought': {
      const paid = updatePlayer(model, event.playerId, (p) => ({ cash: p.cash - event.price }));
      // A tile released by a bankruptcy keeps its buildings when bought.
      const level = paid.tiles[event.tile]?.level ?? 0;
      return updateTile(paid, event.tile, { owner: event.playerId, level });
    }
    case 'PropertyUpgraded': {
      const paid = updatePlayer(model, event.playerId, (p) => ({ cash: p.cash - event.cost }));
      return updateTile(paid, event.tile, { owner: event.playerId, level: event.level });
    }
    case 'RentPaid': {
      const paid = updatePlayer(model, event.from, (p) => ({ cash: p.cash - event.amount }));
      return updatePlayer(paid, event.to, (p) => ({ deposit: p.deposit + event.amount }));
    }
    case 'PlayerBankrupt': {
      const released = new Set(event.releasedTiles);
      let next = updatePlayer(model, event.playerId, () => ({
        cash: 0,
        deposit: 0,
        loan: 0,
        loanDue: null,
        bankrupt: true,
      }));
      next = {
        ...next,
        tiles: next.tiles.map((t, i) => (released.has(i) ? { ...t, owner: null } : t)),
      };
      const { creditor } = event;
      return creditor === null
        ? next
        : updatePlayer(next, creditor, (p) => ({ deposit: p.deposit + event.paidToCreditor }));
    }
    case 'AuctionStarted':
      // With nobody to bid, AuctionUnsold follows at once and the panel only flashes.
      return {
        ...model,
        auction: {
          tile: event.tile,
          startPrice: event.startPrice,
          price: event.startPrice,
          leader: null,
          bidders: event.bidders.map((id) => ({ id, status: 'bidding' })),
          remaining: event.remaining,
        },
      };
    case 'AuctionRaised':
      // A raise asks everyone who passed again.
      return updateAuction(model, (a) => ({
        price: event.price,
        leader: event.playerId,
        bidders: a.bidders.map((b) => (b.status === 'passed' ? { ...b, status: 'bidding' } : b)),
      }));
    case 'AuctionPassed':
      return setBidderStatus(model, event.playerId, 'passed');
    case 'AuctionWithdrawn':
      return setBidderStatus(model, event.playerId, 'withdrawn');
    case 'AuctionWon': {
      const paid = updatePlayer(model, event.playerId, (p) => ({ cash: p.cash - event.price }));
      const level = paid.tiles[event.tile]?.level ?? 0;
      return { ...updateTile(paid, event.tile, { owner: event.playerId, level }), auction: null };
    }
    case 'AuctionUnsold':
      return { ...model, auction: null };
    case 'GameEnded':
      return { ...model, winners: [...event.winners] };
  }
}

const pad = (n: number) => String(n).padStart(2, '0');

function dateText(date: CalendarDate | null | undefined): string {
  return date ? `${date.year}-${pad(date.month)}-${pad(date.day)}` : String(date);
}

/** Fields where two models differ, e.g. "players[1].cash: 900 != 1000"; empty when equal. */
export function diffDisplay(actual: DisplayModel, expected: DisplayModel): string[] {
  const diffs: string[] = [];
  const check = (path: string, a: unknown, b: unknown) => {
    if (a !== b) diffs.push(`${path}: ${String(a)} != ${String(b)}`);
  };
  check('round', actual.round, expected.round);
  check('day', actual.day, expected.day);
  check('priceIndex', actual.priceIndex, expected.priceIndex);
  check('current', actual.current, expected.current);
  check('winners', actual.winners?.join(','), expected.winners?.join(','));
  check('players.length', actual.players.length, expected.players.length);
  expected.players.forEach((e, i) => {
    const a = actual.players[i];
    const keys = [
      'id',
      'name',
      'cash',
      'deposit',
      'tile',
      'vehicle',
      'diceCount',
      'bankrupt',
    ] as const;
    for (const key of keys) {
      check(`players[${i}].${key}`, a?.[key], e[key]);
    }
    check(`players[${i}].loan`, a?.loan, e.loan);
    check(`players[${i}].loanDue`, dateText(a?.loanDue), dateText(e.loanDue));
  });
  check('auction', JSON.stringify(actual.auction), JSON.stringify(expected.auction));
  check('tiles.length', actual.tiles.length, expected.tiles.length);
  expected.tiles.forEach((e, i) => {
    const a = actual.tiles[i];
    check(`tiles[${i}].owner`, a?.owner, e.owner);
    check(`tiles[${i}].level`, a?.level, e.level);
  });
  return diffs;
}
