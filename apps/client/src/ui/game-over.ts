// Result dialog, opened when the GameEnded event has played.
import type { GameEvent, PlayerId, ServerUpdate } from '@richman/shared';
import type { ControllerSink } from '../game-controller';
import { formatMoney, t } from '../i18n';
import type { DisplayModel } from '../model/display';
import { rankPlayers } from './ranking';

export interface GameOverOptions {
  seed: number;
  onAgain(): void;
}

export class GameOverDialog implements ControllerSink {
  constructor(
    private readonly root: HTMLElement,
    private readonly options: GameOverOptions,
  ) {}

  /** Players who went bankrupt in each action, in order. */
  private readonly bankruptcies: PlayerId[][] = [];
  private lastBankruptUpdate: ServerUpdate | null = null;

  eventPlayed(event: GameEvent, model: DisplayModel, update: ServerUpdate): void {
    if (event.type === 'PlayerBankrupt') {
      // One ServerUpdate is one action; bankruptcies in the same action tie.
      if (update !== this.lastBankruptUpdate) this.bankruptcies.push([]);
      this.lastBankruptUpdate = update;
      this.bankruptcies.at(-1)?.push(event.playerId);
      return;
    }
    if (event.type !== 'GameEnded') return;
    const name = (id: string) => model.players.find((p) => p.id === id)?.name ?? id;

    const dialog = document.createElement('div');
    dialog.className = 'game-over';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'game-over-title');

    const title = document.createElement('h1');
    title.id = 'game-over-title';
    title.textContent = t('gameOver.title');
    const reason = document.createElement('p');
    reason.textContent = t(
      event.reason === 'lastStanding'
        ? 'event.gameEnded.lastStanding'
        : 'event.gameEnded.roundLimit',
    );
    const winners = document.createElement('p');
    winners.className = 'game-over-winners';
    winners.textContent =
      event.winners.length > 0
        ? t('gameOver.winners', { names: event.winners.map(name).join('、') })
        : t('gameOver.noWinner');

    const ranked = rankPlayers(
      model.players.map((p) => p.id),
      event,
      this.bankruptcies,
    );
    const table = document.createElement('ol');
    table.className = 'game-over-ranking';
    for (const p of ranked) {
      const item = document.createElement('li');
      if (event.winners.includes(p.id)) item.classList.add('is-winner');
      const label = document.createElement('span');
      label.textContent = `${t('gameOver.rank', { rank: p.rank })} ${name(p.id)}`;
      const detail = document.createElement('span');
      detail.textContent =
        event.reason === 'roundLimit'
          ? `${t('gameOver.totalAssets')} ${formatMoney(p.totalAssets)}`
          : t(p.bankrupt ? 'hud.bankrupt' : 'gameOver.survived');
      item.append(label, detail);
      table.append(item);
    }

    const seed = document.createElement('p');
    seed.className = 'game-over-seed';
    seed.textContent = t('gameOver.seed', { seed: this.options.seed });

    const again = document.createElement('button');
    again.type = 'button';
    again.className = 'primary';
    again.textContent = t('gameOver.again');
    again.addEventListener('click', () => this.options.onAgain());

    dialog.append(title, reason, winners, table, seed, again);
    this.root.replaceChildren(dialog);
    this.root.hidden = false;
    again.focus();
  }
}
