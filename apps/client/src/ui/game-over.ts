// Result dialog, opened when the GameEnded event has played. Like the original it names only the
// winner: the original ends with the winner's dialog and shows no ranking (docs/GAME_RULES.md §1).
import type { GameEvent } from '@richman/shared';
import type { ControllerSink } from '../game-controller';
import { t } from '../i18n';
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
    reason.textContent = t(`event.gameEnded.${event.reason}`);
    const winners = document.createElement('p');
    winners.className = 'game-over-winners';
    winners.textContent =
      event.winners.length > 0
        ? t('gameOver.winners', { names: event.winners.map(name).join('、') })
        : t('gameOver.noWinner');

    const seed = document.createElement('p');
    seed.className = 'game-over-seed';
    seed.textContent = t('gameOver.seed', { seed: this.options.seed });

    const again = document.createElement('button');
    again.type = 'button';
    again.className = 'primary';
    again.textContent = t('gameOver.again');
    again.addEventListener('click', () => this.options.onAgain());

    dialog.append(title, reason, winners, seed, again);
    this.root.replaceChildren(dialog);
    this.root.hidden = false;
    again.focus();
  }
}
