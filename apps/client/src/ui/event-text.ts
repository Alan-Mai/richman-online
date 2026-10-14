// One log line per event, using names from the board and the shown model.
import type { Board, GameEvent, PlayerId, TileIndex } from '@richman/shared';
import { formatMoney, t } from '../i18n';
import type { DisplayModel } from '../model/display';

export function describeEvent(event: GameEvent, model: DisplayModel, board: Board): string {
  const name = (id: PlayerId) => model.players.find((p) => p.id === id)?.name ?? id;
  const tile = (i: TileIndex) => board.tiles[i]?.name ?? String(i);
  switch (event.type) {
    case 'TurnStarted':
      return t('event.turnStarted', { name: name(event.playerId) });
    case 'DayAdvanced':
      return t('event.dayAdvanced', { day: event.day, priceIndex: event.priceIndex });
    case 'DiceRolled':
      return t('event.diceRolled', {
        name: name(event.playerId),
        dice: event.dice.join('、'),
        total: event.total,
      });
    case 'PlayerMoved':
      return t('event.moved', {
        name: name(event.playerId),
        tile: tile(event.path.at(-1) ?? 0),
      });
    case 'PlayerPlaced':
      return t('event.playerPlaced', { name: name(event.playerId), tile: tile(event.tile) });
    case 'PropertyBought':
      return t('event.propertyBought', {
        name: name(event.playerId),
        price: formatMoney(event.price),
        tile: tile(event.tile),
      });
    case 'PropertyUpgraded':
      return t('event.propertyUpgraded', {
        name: name(event.playerId),
        cost: formatMoney(event.cost),
        tile: tile(event.tile),
        level: event.level,
      });
    case 'RentPaid':
      return t('event.rentPaid', {
        from: name(event.from),
        to: name(event.to),
        tile: tile(event.tile),
        amount: formatMoney(event.amount),
      });
    case 'DepositWithdrawn':
      return t('event.depositWithdrawn', {
        name: name(event.playerId),
        amount: formatMoney(event.amount),
      });
    case 'PlayerBankrupt':
      if (event.cause.kind === 'rent' && event.creditor !== null) {
        return t('event.bankruptRent', {
          name: name(event.playerId),
          tile: tile(event.cause.tile),
          amount: formatMoney(event.cause.amountDue),
          creditor: name(event.creditor),
          paid: formatMoney(event.paidToCreditor),
        });
      }
      return t('event.bankrupt', { name: name(event.playerId) });
    case 'GameEnded':
      return t(
        event.reason === 'lastStanding'
          ? 'event.gameEnded.lastStanding'
          : 'event.gameEnded.roundLimit',
      );
  }
}
