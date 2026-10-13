// Picks where converted maps come from (dev server or an imported folder) and which map to view.
import type { AssetSource } from '../assets/asset-source';
import { pickedFromFileList, importedAssetSource } from '../assets/imported-source';
import { loadMapIndex, type MapFileError } from '../assets/map-preview';
import { t } from '../i18n';

export function describeMapFileError(error: MapFileError): string {
  switch (error.kind) {
    case 'missing':
      return t('preview.error.missing', { path: error.path });
    case 'notJson':
      return t('preview.error.notJson', { path: error.path });
    case 'version':
      return t('preview.error.version', { path: error.path, found: String(error.found) });
    case 'outdated':
      return t('preview.error.outdated', { path: error.path });
    case 'invalid':
      return t('preview.error.invalid', { path: error.path, field: error.field });
  }
}

export interface PreviewChooserOptions {
  /** The dev-server source; null in production builds. */
  devSource: AssetSource | null;
  /** A folder imported earlier in this visit, shown again so it need not be picked twice. */
  imported: AssetSource | null;
  /** A folder was picked; the app keeps it (and frees the previous one). */
  onImport(source: AssetSource): void;
  onPick(source: AssetSource, map: number): void;
  onBack(): void;
  /** Shown above the lists, e.g. why a map failed to open. */
  message?: string;
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

/** Resolves once the dev source has been checked (tests await it). */
export function renderPreviewChooser(
  root: HTMLElement,
  options: PreviewChooserOptions,
): Promise<void> {
  const panel = el('div', 'preview-chooser');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-labelledby', 'preview-title');
  const title = el('h1', undefined, t('preview.title'));
  title.id = 'preview-title';
  const message = el('p', 'preview-message', options.message ?? '');
  message.setAttribute('role', 'alert');
  const devSection = el('section', 'preview-source');
  const importSection = el('section', 'preview-source');

  const mapButtons = (source: AssetSource, maps: number[]) => {
    const list = el('div', 'preview-maps');
    for (const n of maps) {
      const button = el('button', 'secondary', t('preview.map', { n }));
      button.type = 'button';
      button.dataset.map = String(n);
      button.addEventListener('click', () => options.onPick(source, n));
      list.append(button);
    }
    return list;
  };

  /** Lists the maps of a source; when index.json is missing, `missingHint` (if any) replaces the error. */
  const showSource = async (
    section: HTMLElement,
    heading: string,
    source: AssetSource,
    missingHint?: string,
  ) => {
    const index = await loadMapIndex(source);
    if (index.ok) {
      section.replaceChildren(el('h2', undefined, heading), mapButtons(source, index.value));
    } else if (index.error.kind === 'missing' && missingHint) {
      section.replaceChildren(el('p', 'preview-hint', missingHint));
    } else {
      section.replaceChildren(el('p', 'preview-error', describeMapFileError(index.error)));
    }
  };

  const input = el('input');
  input.type = 'file';
  input.multiple = true;
  input.setAttribute('webkitdirectory', '');
  input.hidden = true;
  const importButton = el('button', 'secondary', t('preview.import'));
  importButton.type = 'button';
  importButton.addEventListener('click', () => input.click());
  const importResult = el('div');
  input.addEventListener('change', () => {
    const source = input.files ? importedAssetSource(pickedFromFileList(input.files)) : null;
    if (!source) {
      importResult.replaceChildren(el('p', 'preview-error', t('preview.importMissing')));
      return;
    }
    options.onImport(source);
    void showSource(importResult, t('preview.imported'), source);
  });
  importSection.append(importButton, input, importResult);

  const back = el('button', 'secondary', t('preview.back'));
  back.type = 'button';
  back.addEventListener('click', () => options.onBack());

  panel.append(
    title,
    el('p', 'preview-note', t('preview.note')),
    message,
    devSection,
    importSection,
    back,
  );
  if (!options.message) message.hidden = true;
  root.replaceChildren(panel);

  const pending: Promise<unknown>[] = [];
  if (options.imported) {
    pending.push(showSource(importResult, t('preview.imported'), options.imported));
  }
  const dev = options.devSource;
  if (dev) {
    devSection.textContent = t('preview.loading');
    pending.push(showSource(devSection, t('preview.devFound'), dev, t('preview.devMissing')));
  }
  return Promise.all(pending).then(() => undefined);
}
