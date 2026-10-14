// What the screen currently shows. It advances one GameEvent at a time while animations play and
// is checked against the authoritative PlayerView once a batch of events has been played.
import type { GameEvent, PlayerId, PlayerView, TileIndex } from '@richman/shared';

export interface DisplayPlayer {
  id: PlayerId;
  name: string;
  cash: number;
  deposit: number;
  /** null until the player is placed on their first turn. */
  tile: TileIndex | null;
  bankrupt: boolean;
}

export interface DisplayTile {
  owner: PlayerId | null;
  level: number;
}

export interface DisplayModel {
  round: number;
  /** Days gone by (GameState.day). */
  day: number;
  priceIndex: number;
  current: PlayerId;
  players: readonly DisplayPlayer[];
  tiles: readonly DisplayTile[];
  /** null until the game ends. */
  winners: readonly PlayerId[] | null;
}

export function displayFromView(view: PlayerView): DisplayModel {
  const { phase } = view.turn;
  return {
    round: view.turn.round,
    day: view.day,
    priceIndex: view.priceIndex,
    current: view.turn.current,
    players: view.players.map(({ id, name, cash, deposit, location, bankrupt }) => ({
      id,
      name,
      cash,
      deposit,
      tile: location.kind === 'onBoard' ? location.tile : null,
      bankrupt,
    })),
    tiles: view.tiles.map(({ owner, level }) => ({ owner, level })),
    winners: phase.kind === 'gameOver' ? [...phase.winners] : null,
  };
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
      return { ...model, day: event.day, priceIndex: event.priceIndex };
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
    case 'PropertyBought': {
      const paid = updatePlayer(model, event.playerId, (p) => ({ cash: p.cash - event.price }));
      return updateTile(paid, event.tile, { owner: event.playerId, level: 0 });
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
        bankrupt: true,
      }));
      next = {
        ...next,
        tiles: next.tiles.map((t, i) => (released.has(i) ? { owner: null, level: 0 } : t)),
      };
      const { creditor } = event;
      return creditor === null
        ? next
        : updatePlayer(next, creditor, (p) => ({ deposit: p.deposit + event.paidToCreditor }));
    }
    case 'GameEnded':
      return { ...model, winners: [...event.winners] };
  }
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
    for (const key of ['id', 'name', 'cash', 'deposit', 'tile', 'bankrupt'] as const) {
      check(`players[${i}].${key}`, a?.[key], e[key]);
    }
  });
  check('tiles.length', actual.tiles.length, expected.tiles.length);
  expected.tiles.forEach((e, i) => {
    const a = actual.tiles[i];
    check(`tiles[${i}].owner`, a?.owner, e.owner);
    check(`tiles[${i}].level`, a?.level, e.level);
  });
  return diffs;
}
