// @vitest-environment happy-dom
// All map data here is invented for the tests.
import { beforeEach, describe, expect, it } from 'vitest';
import type { AssetSource } from '../assets/asset-source';
import type { MapPreview } from '../assets/map-preview';
import { renderPreviewChooser } from './preview-chooser';
import { PreviewPanel } from './preview-panel';

function source(files: Record<string, string>, kind: AssetSource['kind'] = 'dev'): AssetSource {
  return {
    kind,
    readText: (path) => Promise.resolve(files[path] ?? null),
    imageUrl: () => Promise.resolve(null),
    dispose: () => {},
  };
}

let root: HTMLElement;
let picked: [AssetSource, number][];
let backs: number;

beforeEach(() => {
  root = document.createElement('div');
  picked = [];
  backs = 0;
});

async function render(
  devSource: AssetSource | null,
  imported: AssetSource | null = null,
  message?: string,
) {
  await renderPreviewChooser(root, {
    devSource,
    imported,
    message,
    onImport: () => {},
    onPick: (s, n) => picked.push([s, n]),
    onBack: () => backs++,
  });
}

const mapButtons = () => [...root.querySelectorAll<HTMLButtonElement>('[data-map]')];

describe('renderPreviewChooser', () => {
  it('lists the maps found through the dev server and opens the clicked one', async () => {
    const dev = source({ 'index.json': '{"maps":[1,0]}' });
    await render(dev);
    expect(mapButtons().map((b) => b.textContent)).toEqual(['地圖 0', '地圖 1']);
    mapButtons()[1]!.click();
    expect(picked).toEqual([[dev, 1]]);
  });

  it('explains how to get maps when the dev server has none', async () => {
    await render(source({}));
    expect(root.textContent).toContain('pnpm -F extract cli map');
    expect(mapButtons()).toEqual([]);
  });

  it('offers only importing in production builds', async () => {
    await render(null);
    expect(root.textContent).toContain('匯入轉檔資料夾');
    expect(root.textContent).not.toContain('pnpm -F extract cli map');
  });

  it('shows a previously imported folder again', async () => {
    const imported = source({ 'index.json': '{"maps":[5]}' }, 'imported');
    await render(null, imported);
    expect(mapButtons().map((b) => b.dataset.map)).toEqual(['5']);
  });

  it('reports a broken index', async () => {
    await render(source({ 'index.json': '{"maps":"x"}' }));
    expect(root.textContent).toContain('index.json 的內容不正確（maps）');
  });

  it('shows a message and goes back', async () => {
    await render(null, null, '背景圖載入失敗');
    expect(root.querySelector('.preview-message')?.textContent).toBe('背景圖載入失敗');
    [...root.querySelectorAll('button')].find((b) => b.textContent === '返回')!.click();
    expect(backs).toBe(1);
  });

  it('keeps the import input to folders', async () => {
    await render(null);
    const input = root.querySelector<HTMLInputElement>('input[type="file"]')!;
    expect(input.hasAttribute('webkitdirectory')).toBe(true);
  });
});

describe('PreviewPanel', () => {
  const preview: MapPreview = {
    map: 3,
    background: { file: 'background.png', width: 64, height: 64 },
    squares: [
      { x: 1, y: 1, name: '甲地', links: [1] },
      { x: 2, y: 2, name: '', links: [] },
    ],
  };

  it('shows the map, then the selected square and its links', () => {
    let back = 0;
    const panel = new PreviewPanel(root, preview, () => back++);
    expect(root.textContent).toContain('原版地圖 3（唯讀預覽）');
    expect(root.textContent).toContain('格子 2 個');
    panel.showSquare(0);
    expect(root.querySelector('.hud-tile')?.textContent).toBe('格子 #0 甲地相鄰格子：#1');
    panel.showSquare(1);
    expect(root.querySelector('.hud-tile')?.textContent).toBe('格子 #1 （無名稱）沒有相鄰格子');
    root.querySelector('button')!.click();
    expect(back).toBe(1);
  });
});
