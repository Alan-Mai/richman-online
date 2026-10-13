// Side panel next to the read-only map preview.
import type { MapPreview } from '../assets/map-preview';
import { t } from '../i18n';

export class PreviewPanel {
  private readonly detail = document.createElement('section');

  constructor(
    root: HTMLElement,
    private readonly preview: MapPreview,
    onBack: () => void,
  ) {
    const title = document.createElement('h2');
    title.textContent = t('preview.mapTitle', { n: preview.map });
    const count = document.createElement('p');
    count.textContent = t('preview.squareCount', { count: preview.squares.length });
    const note = document.createElement('p');
    note.className = 'hud-hint';
    note.textContent = t('preview.note');
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'secondary';
    back.textContent = t('preview.back');
    back.addEventListener('click', onBack);
    this.detail.className = 'hud-tile';
    this.showSquare(null);
    root.replaceChildren(title, count, this.detail, note, back);
  }

  showSquare(index: number | null): void {
    const sq = index === null ? undefined : this.preview.squares[index];
    if (index === null || !sq) {
      const hint = document.createElement('p');
      hint.className = 'hud-hint';
      hint.textContent = t('preview.hint');
      this.detail.replaceChildren(hint);
      return;
    }
    const heading = document.createElement('h2');
    heading.textContent = `${t('preview.square', { index })} ${sq.name || t('preview.unnamed')}`;
    const links = document.createElement('p');
    links.textContent =
      sq.links.length > 0
        ? t('preview.links', { links: sq.links.map((j) => `#${j}`).join('、') })
        : t('preview.noLinks');
    this.detail.replaceChildren(heading, links);
  }
}
