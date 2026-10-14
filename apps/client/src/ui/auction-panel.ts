// The bankruptcy auction (docs/GAME_RULES.md §8) as a HUD section. Like the original's dialog it
// lists every player still in the game with their cash, marks who may not bid, shows the current
// price and the highest bidder, and gives the bidder five raises, passing the round and withdrawing.
import type { Board, PlayerId, ServerUpdate } from '@richman/shared';
import { formatMoney, t } from '../i18n';
import type { DisplayModel } from '../model/display';
import { toIntent, type Intent } from '../net/connection';

export interface AuctionPanelInput {
  model: DisplayModel;
  board: Board;
  /** The raises of RuleConfig.auctionRaises, in order. */
  raises: readonly number[];
  /** The latest fully played update; null while events are playing. */
  ready: ServerUpdate | null;
  onAct: (intent: Intent) => void;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Whose turn it is to bid, from the latest view; null while playing or outside auctions. */
export function auctionBidder(ready: ServerUpdate | null): PlayerId | null {
  const phase = ready?.view.turn.phase;
  return phase?.kind === 'auction' ? phase.bidder : null;
}

export function renderAuctionPanel(root: HTMLElement, input: AuctionPanelInput): void {
  const { model, board, raises, ready, onAct } = input;
  const { auction } = model;
  root.hidden = auction === null;
  if (auction === null) {
    root.replaceChildren();
    return;
  }

  const name = (id: PlayerId) => model.players.find((p) => p.id === id)?.name ?? id;
  const level = model.tiles[auction.tile]?.level ?? 0;
  const title = el(
    'h2',
    undefined,
    t('auction.title', { tile: board.tiles[auction.tile]?.name ?? String(auction.tile), level }),
  );

  const facts = el('dl', 'auction-facts');
  const fact = (label: string, value: string, className?: string) =>
    facts.append(el('dt', undefined, label), el('dd', className, value));
  fact(t('auction.startPrice'), formatMoney(auction.startPrice));
  fact(t('auction.price'), formatMoney(auction.price), 'auction-price');
  fact(t('auction.leader'), auction.leader === null ? t('auction.noLeader') : name(auction.leader));
  fact(t('auction.remaining'), String(auction.remaining));

  const bidder = auctionBidder(ready);
  const rows = el('ul', 'auction-bidders');
  for (const player of model.players.filter((p) => !p.bankrupt)) {
    const entry = auction.bidders.find((b) => b.id === player.id);
    const row = el('li', 'auction-bidder');
    row.dataset.player = player.id;
    if (player.id === bidder) row.setAttribute('aria-current', 'true');
    if (player.id === auction.leader) row.classList.add('is-leader');
    if (entry === undefined || entry.status === 'withdrawn') row.classList.add('is-out');
    const status =
      entry === undefined
        ? t('auction.status.ineligible')
        : player.id === auction.leader
          ? t('auction.status.leading', { price: formatMoney(auction.price) })
          : t(`auction.status.${entry.status}`);
    row.append(
      el('span', 'auction-name', player.name),
      el('span', 'auction-cash', t('auction.cash', { cash: formatMoney(player.cash) })),
      el('span', 'auction-status', status),
    );
    rows.append(row);
  }

  root.replaceChildren(title, facts, rows);

  const offered = ready?.legalActions ?? [];
  const inAuction = offered.filter(
    (a) => a.type === 'bid' || a.type === 'passRound' || a.type === 'withdraw',
  );
  if (inAuction.length === 0) return;
  const buttons = el('div', 'auction-actions');
  // Like the original, every raise is shown; the ones the bidder's cash does not cover are off.
  for (const raise of raises) {
    const action = inAuction.find((a) => a.type === 'bid' && a.raise === raise);
    const button = el('button', 'primary', t('auction.raise', { raise: formatMoney(raise) }));
    button.type = 'button';
    button.title = t('auction.raiseTo', { price: formatMoney(auction.price + raise) });
    button.dataset.raise = String(raise);
    button.disabled = action === undefined;
    if (action) button.addEventListener('click', () => onAct(toIntent(action)));
    buttons.append(button);
  }
  for (const action of inAuction.filter((a) => a.type !== 'bid')) {
    const button = el('button', 'secondary', t(`action.${action.type}`));
    button.type = 'button';
    button.dataset.action = action.type;
    button.addEventListener('click', () => onAct(toIntent(action)));
    buttons.append(button);
  }
  root.append(buttons);
}
