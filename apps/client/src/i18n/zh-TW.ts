// Player-visible text, default locale. Placeholders are written as {name}.
export const zhTW = {
  'action.rollDice': '擲骰子',
  'action.buyProperty': '購買（{price}）',
  'action.upgradeProperty': '加蓋（{cost}）',
  'action.decline': '放棄',

  'setup.defaultName': '玩家 {n}',

  'hud.round': '第 {round} 輪',
  'hud.cash': '現金',
  'hud.deposit': '存款',
  'hud.bankrupt': '破產',

  'event.turnStarted': '輪到 {name}',
  'event.diceRolled': '{name} 擲出 {dice}，共 {total} 點',
  'event.moved': '{name} 走到 {tile}',
  'event.passBonus': '{name} 經過 {tile}，獲得 {amount}',
  'event.propertyBought': '{name} 以 {price} 買下 {tile}',
  'event.propertyUpgraded': '{name} 花費 {cost} 把 {tile} 加蓋到 {level} 級',
  'event.rentPaid': '{from} 在 {tile} 付給 {to} 過路費 {amount}',
  'event.depositWithdrawn': '{name} 現金不足，從存款提出 {amount}',
  'event.bankrupt': '{name} 破產了',
  'event.gameEnded.lastStanding': '遊戲結束：只剩一位玩家',
  'event.gameEnded.roundLimit': '遊戲結束：已達回合上限',
} as const satisfies Record<string, string>;
