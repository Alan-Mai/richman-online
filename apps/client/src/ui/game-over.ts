// Result dialog, opened when the GameEnded event has played.
import type { GameEvent } from '@richman/shared';
import type { ControllerSink } from '../game-controller';
import { formatMoney, t } from '../i18n';
import type { DisplayModel } from '../model/display';

export interface GameOverOptions {
  seed: number;
  onAgain(): void;
}

export class GameOverDialog implements ControllerSink {
  constructor(
    private readonly root: HTMLElement,
    private readonly options: GameOverOptions,
  ) {}

  eventPlayed(event: GameEvent, model: DisplayModel): void {
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

    // Ranked by total assets; equal totals share a rank.
    const ranked = model.players
      .map((p) => ({ ...p, total: event.totalAssets[p.id] ?? 0 }))
      .sort((a, b) => b.total - a.total);
    const table = document.createElement('ol');
    table.className = 'game-over-ranking';
    ranked.forEach((p) => {
      const rank = ranked.findIndex((q) => q.total === p.total) + 1;
      const item = document.createElement('li');
      if (event.winners.includes(p.id)) item.classList.add('is-winner');
      const label = document.createElement('span');
      label.textContent = `${t('gameOver.rank', { rank })} ${p.name}`;
      const total = document.createElement('span');
      total.textContent = `${t('gameOver.totalAssets')} ${formatMoney(p.total)}`;
      item.append(label, total);
      table.append(item);
    });

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
