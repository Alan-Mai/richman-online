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
    case 'DiceCountSet':
      return t('event.diceCountSet', { name: name(event.playerId), count: event.count });
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
    case 'AuctionStarted': {
      const started = t('event.auctionStarted', {
        tile: tile(event.tile),
        price: formatMoney(event.startPrice),
        remaining: event.remaining,
      });
      return event.bidders.length > 0 ? started : `${started}；${t('event.auctionNoBidders')}`;
    }
    case 'AuctionRaised':
      return t('event.auctionRaised', {
        name: name(event.playerId),
        raise: formatMoney(event.raise),
        price: formatMoney(event.price),
      });
    case 'AuctionPassed':
      return t('event.auctionPassed', { name: name(event.playerId) });
    case 'AuctionWithdrawn':
      return t(
        event.reason === 'shortOfCash'
          ? 'event.auctionWithdrawnShortOfCash'
          : 'event.auctionWithdrawn',
        { name: name(event.playerId) },
      );
    case 'AuctionWon':
      return t('event.auctionWon', {
        name: name(event.playerId),
        price: formatMoney(event.price),
        tile: tile(event.tile),
      });
    case 'AuctionUnsold':
      return t('event.auctionUnsold', { tile: tile(event.tile) });
    case 'BankOpened':
      return t(event.trigger === 'pass' ? 'event.bankOpenedPass' : 'event.bankOpenedLand', {
        name: name(event.playerId),
        tile: tile(event.tile),
      });
    case 'BankTransferred':
      return t(event.direction === 'withdraw' ? 'event.bankWithdrew' : 'event.bankDeposited', {
        name: name(event.playerId),
        amount: formatMoney(event.amount),
      });
    case 'BankRebalanced':
      return t('event.bankRebalanced', {
        name: name(event.playerId),
        tile: tile(event.tile),
        cash: formatMoney(event.cash),
        deposit: formatMoney(event.deposit),
      });
    case 'GameEnded':
      return t(`event.gameEnded.${event.reason}`);
  }
}
