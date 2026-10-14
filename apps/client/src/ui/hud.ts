// DOM overlay: player panels, round, action buttons, event log and tile info. Buttons come only
// from the legal actions of the latest fully played update.
import {
  buyPrice,
  netWorth,
  rentFor,
  upgradeCost,
  type ActionType,
  type Board,
  type GameEvent,
  type RuleConfig,
  type ServerUpdate,
  type TileIndex,
} from '@richman/shared';
import type { ControllerSink } from '../game-controller';
import { formatMoney, t } from '../i18n';
import type { DisplayModel } from '../model/display';
import { GAME_SPEEDS, isGameSpeed, type GameSpeed } from '../render/timings';
import { cssColor, playerColor } from '../theme';
import { toIntent, type Intent } from '../net/connection';
import { auctionBidder, renderAuctionPanel } from './auction-panel';
import { describeEvent } from './event-text';

const LOG_LIMIT = 50;

export interface HudOptions {
  board: Board;
  /** For the day limit and net worth target shown under the round, and the auction raises. */
  config: RuleConfig;
  onAct(intent: Intent): void;
  /** Shows the game speed control when given. */
  gameSpeed?: { initial: GameSpeed; onChange(speed: GameSpeed): void };
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

function gameSpeedControl(options: NonNullable<HudOptions['gameSpeed']>): HTMLLabelElement {
  const select = el('select');
  select.name = 'gameSpeed';
  for (const speed of GAME_SPEEDS) {
    const option = el('option', undefined, t(`hud.gameSpeed.${speed}`));
    option.value = String(speed);
    option.selected = speed === options.initial;
    select.append(option);
  }
  select.addEventListener('change', () => {
    const speed = Number(select.value);
    if (isGameSpeed(speed)) options.onChange(speed);
  });
  const label = el('label', 'hud-speed');
  label.append(el('span', undefined, t('hud.gameSpeed')), select);
  return label;
}

/** Button text for an offered action, with the price or cost of the pending offer. */
export function actionLabel(type: ActionType, update: ServerUpdate): string {
  const { phase } = update.view.turn;
  switch (type) {
    case 'rollDice':
      return t('action.rollDice');
    case 'buyProperty':
      return t('action.buyProperty', {
        price: formatMoney(phase.kind === 'awaitBuyDecision' ? phase.price : 0),
      });
    case 'upgradeProperty':
      return t('action.upgradeProperty', {
        cost: formatMoney(phase.kind === 'awaitUpgradeDecision' ? phase.cost : 0),
      });
    case 'decline':
      return t('action.decline');
    case 'bid': {
      // The auction panel labels its own raise buttons; this is the smallest raise on offer.
      const raise = update.legalActions.find((a) => a.type === 'bid');
      return t('action.bid', { raise: formatMoney(raise?.type === 'bid' ? raise.raise : 0) });
    }
    case 'passRound':
      return t('action.passRound');
    case 'withdraw':
      return t('action.withdraw');
  }
}

export class Hud implements ControllerSink {
  private readonly round = el('div', 'hud-round');
  private readonly calendar = el('div', 'hud-calendar');
  private readonly limits = el('div', 'hud-limits');
  private readonly players = el('ol', 'hud-players');
  private readonly prompt = el('div', 'hud-prompt');
  private readonly actions = el('div', 'hud-actions');
  private readonly auction = el('section', 'hud-auction');
  private readonly tileInfo = el('section', 'hud-tile');
  private readonly log = el('ol', 'hud-log');
  private model: DisplayModel | null = null;
  private ready: ServerUpdate | null = null;
  private selectedTile: TileIndex | null = null;

  constructor(
    root: HTMLElement,
    private readonly options: HudOptions,
  ) {
    this.players.setAttribute('aria-label', t('hud.players'));
    this.log.setAttribute('aria-label', t('hud.log'));
    this.log.setAttribute('aria-live', 'polite');
    const logSection = el('section', 'hud-log-section');
    logSection.append(el('h2', undefined, t('hud.log')), this.log);
    this.renderLimits();
    root.replaceChildren(
      this.round,
      this.calendar,
      this.limits,
      this.prompt,
      this.actions,
      this.auction,
      this.players,
      this.tileInfo,
      logSection,
      ...(options.gameSpeed ? [gameSpeedControl(options.gameSpeed)] : []),
      el('p', 'hud-shortcuts', t('hud.shortcuts')),
    );
    this.renderTile();
  }

  showModel(model: DisplayModel): void {
    this.model = model;
    this.round.textContent = t('hud.round', { round: model.round });
    this.calendar.textContent = t('hud.calendar', {
      day: model.day,
      priceIndex: model.priceIndex,
    });
    const view = { ...model, board: this.options.board };
    this.players.replaceChildren(
      ...model.players.map((p, seat) => {
        const item = el('li', 'hud-player');
        if (p.id === model.current) item.setAttribute('aria-current', 'true');
        if (p.bankrupt) item.classList.add('is-bankrupt');
        const swatch = el('span', 'hud-swatch');
        swatch.style.background = cssColor(playerColor(seat));
        const name = el('span', 'hud-name', p.name);
        const money = el('dl', 'hud-money');
        money.append(
          el('dt', undefined, t('hud.cash')),
          el('dd', 'hud-cash', formatMoney(p.cash)),
          el('dt', undefined, t('hud.deposit')),
          el('dd', 'hud-deposit', formatMoney(p.deposit)),
          el('dt', undefined, t('hud.netWorth')),
          el('dd', 'hud-networth', formatMoney(netWorth(view, p.id))),
        );
        item.append(swatch, name, money);
        if (p.bankrupt) item.append(el('span', 'hud-tag', t('hud.bankrupt')));
        else if (p.tile === null)
          item.append(el('span', 'hud-tag is-waiting', t('hud.notStarted')));
        return item;
      }),
    );
    this.renderAuction();
    this.renderTile();
  }

  eventPlayed(event: GameEvent, model: DisplayModel): void {
    this.log.prepend(el('li', undefined, describeEvent(event, model, this.options.board)));
    while (this.log.children.length > LOG_LIMIT) this.log.lastElementChild?.remove();
  }

  setReady(update: ServerUpdate | null): void {
    this.ready = update;
    this.renderActions();
    this.renderAuction();
    this.renderTile();
  }

  private renderLimits(): void {
    const { dayLimit, netWorthTargetMultiple, startingFunds } = this.options.config;
    const parts = [
      ...(dayLimit === null ? [] : [t('hud.dayLimit', { days: dayLimit })]),
      ...(netWorthTargetMultiple === null
        ? []
        : [
            t('hud.netWorthTarget', {
              amount: formatMoney(netWorthTargetMultiple * startingFunds),
            }),
          ]),
    ];
    this.limits.textContent = parts.join('　');
    this.limits.hidden = parts.length === 0;
  }

  /** Shows details of a tile (from a click on the board); null clears the panel. */
  showTile(tile: TileIndex | null): void {
    this.selectedTile = tile;
    this.renderTile();
  }

  private renderActions(): void {
    const update = this.ready;
    if (!update) {
      this.prompt.textContent = this.model?.winners ? '' : t('hud.playing');
      this.actions.replaceChildren();
      return;
    }
    const bidder = auctionBidder(update);
    const actorId = bidder ?? update.view.turn.current;
    const actor = update.view.players.find((p) => p.id === actorId);
    const offered = update.legalActions.length > 0 && actor !== undefined;
    this.prompt.textContent = !offered
      ? ''
      : t(bidder === null ? 'hud.yourTurn' : 'hud.auctionTurn', { name: actor.name });
    // The auction panel has its own buttons.
    const turnActions = bidder === null ? update.legalActions : [];
    this.actions.replaceChildren(
      ...turnActions.map((action) => {
        const { type } = action;
        const button = el(
          'button',
          type === 'decline' ? 'secondary' : 'primary',
          actionLabel(type, update),
        );
        button.type = 'button';
        button.dataset.action = type;
        button.addEventListener('click', () => this.options.onAct(toIntent(action)));
        return button;
      }),
    );
  }

  private renderAuction(): void {
    if (!this.model) return;
    renderAuctionPanel(this.auction, {
      model: this.model,
      board: this.options.board,
      raises: this.options.config.auctionRaises,
      ready: this.ready,
      onAct: (intent) => this.options.onAct(intent),
    });
  }

  private renderTile(): void {
    const index = this.selectedTile;
    const def = index === null ? undefined : this.options.board.tiles[index];
    if (index === null || !def) {
      this.tileInfo.replaceChildren(el('p', 'hud-hint', t('tile.hint')));
      return;
    }
    const rows: [string, string][] = [];
    if (def.kind === 'property') {
      const state = this.model?.tiles[index];
      const owner = state?.owner
        ? this.model?.players.find((p) => p.id === state.owner)
        : undefined;
      const level = state?.level ?? 0;
      rows.push([t('tile.price'), formatMoney(def.price)]);
      rows.push([t('tile.owner'), owner?.name ?? t('tile.noOwner')]);
      rows.push([t('tile.level'), String(level)]);
      if (this.model) {
        // Prices as the engine computes them: price index, buildings and the whole street.
        const view = { ...this.model, board: this.options.board };
        if (!owner) rows.push([t('tile.buyPrice'), formatMoney(buyPrice(view, index))]);
        if (owner) rows.push([t('tile.rent'), formatMoney(rentFor(view, index))]);
        rows.push([t('tile.upgradeCost'), formatMoney(upgradeCost(view, index))]);
      }
    }
    const list = el('dl');
    for (const [term, value] of rows)
      list.append(el('dt', undefined, term), el('dd', undefined, value));
    this.tileInfo.replaceChildren(
      el('h2', undefined, def.name),
      def.kind === 'property' ? list : el('p', undefined, t('tile.notProperty')),
    );
  }
}
