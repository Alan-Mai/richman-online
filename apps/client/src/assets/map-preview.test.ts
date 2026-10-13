// All map data here is invented for the tests; nothing comes from converted files.
import { describe, expect, it } from 'vitest';
import type { AssetSource } from './asset-source';
import { importedAssetSource, findMapsRoot } from './imported-source';
import { loadMapIndex, loadMapPreview, parseMapIndex, parseMapPreview } from './map-preview';

function fakeMap(patch: Record<string, unknown> = {}) {
  return {
    version: 1,
    generatedAt: '2000-01-01T00:00:00.000Z',
    map: 2,
    source: { file: 'fake', gndIndex: 0, dataIndex: 1 },
    background: {
      file: 'background.png',
      width: 64,
      height: 32,
      columns: 2,
      rows: 1,
      tileSize: 32,
    },
    squares: [
      { x: 10, y: 10, name: '甲地', links: [1, null, null, null], ref: null },
      { x: 40, y: 12, name: '', links: [0, null, null, null], ref: null },
    ],
    section1: [],
    section2: [],
    section3: [],
    section4: [],
    ...patch,
  };
}

const text = (value: unknown) => JSON.stringify(value);

describe('parseMapIndex', () => {
  it('returns sorted unique map numbers', () => {
    expect(parseMapIndex(text({ maps: [3, 0, 3, 1] }))).toEqual({ ok: true, value: [0, 1, 3] });
  });

  it.each([
    ['not json', '{', 'notJson'],
    ['no maps', text({}), 'invalid'],
    ['bad entry', text({ maps: [0, -1] }), 'invalid'],
    ['fraction', text({ maps: [1.5] }), 'invalid'],
  ])('rejects %s', (_, input, kind) => {
    expect(parseMapIndex(input)).toMatchObject({ ok: false, error: { kind } });
  });
});

describe('parseMapPreview', () => {
  it('keeps what the preview draws and drops empty links', () => {
    const parsed = parseMapPreview(text(fakeMap()), '2/map.json');
    expect(parsed).toEqual({
      ok: true,
      value: {
        map: 2,
        background: { file: 'background.png', width: 64, height: 32 },
        squares: [
          { x: 10, y: 10, name: '甲地', links: [1] },
          { x: 40, y: 12, name: '', links: [0] },
        ],
      },
    });
  });

  it('reports an unsupported version', () => {
    expect(parseMapPreview(text(fakeMap({ version: 2 })), 'm')).toEqual({
      ok: false,
      error: { kind: 'version', path: 'm', found: 2 },
    });
  });

  it.each([
    [
      'background outside the folder',
      { background: { file: '../x.png', width: 1, height: 1 } },
      'background',
    ],
    ['background not png', { background: { file: 'x.json', width: 1, height: 1 } }, 'background'],
    ['empty background', { background: { file: 'b.png', width: 0, height: 1 } }, 'background'],
    ['missing squares', { squares: undefined }, 'squares'],
    ['bad coordinate', { squares: [{ x: 'a', y: 1, name: '', links: [] }] }, 'squares[0]'],
    ['missing name', { squares: [{ x: 1, y: 1, links: [] }] }, 'squares[0].name'],
    ['link out of range', { squares: [{ x: 1, y: 1, name: '', links: [5] }] }, 'squares[0].links'],
    ['negative link', { squares: [{ x: 1, y: 1, name: '', links: [-1] }] }, 'squares[0].links'],
    ['bad map number', { map: 'x' }, 'map'],
  ])('rejects %s', (_, patch, field) => {
    expect(parseMapPreview(text(fakeMap(patch)), 'm')).toEqual({
      ok: false,
      error: { kind: 'invalid', path: 'm', field },
    });
  });

  it('rejects non-JSON', () => {
    expect(parseMapPreview('nope', 'm')).toEqual({
      ok: false,
      error: { kind: 'notJson', path: 'm' },
    });
  });
});

function source(files: Record<string, string>): AssetSource {
  return {
    kind: 'dev',
    readText: (path) => Promise.resolve(files[path] ?? null),
    imageUrl: (path) => Promise.resolve(path in files ? `url:${path}` : null),
    dispose: () => {},
  };
}

describe('loadMapIndex / loadMapPreview', () => {
  it('reports a missing index', async () => {
    expect(await loadMapIndex(source({}))).toEqual({
      ok: false,
      error: { kind: 'missing', path: 'index.json' },
    });
  });

  it('loads a map with its background', async () => {
    const files = { '2/map.json': text(fakeMap()), '2/background.png': 'png' };
    const loaded = await loadMapPreview(source(files), 2);
    expect(loaded.ok && loaded.value.backgroundUrl).toBe('url:2/background.png');
  });

  it('reports a missing map or background', async () => {
    expect(await loadMapPreview(source({}), 2)).toMatchObject({
      ok: false,
      error: { kind: 'missing', path: '2/map.json' },
    });
    expect(await loadMapPreview(source({ '2/map.json': text(fakeMap()) }), 2)).toMatchObject({
      ok: false,
      error: { kind: 'missing', path: '2/background.png' },
    });
  });
});

describe('importedAssetSource', () => {
  const blob = (s: string) => new Blob([s]);

  it('finds the maps folder whether local-assets or maps was picked', () => {
    expect(findMapsRoot(['local-assets/inventory.json', 'local-assets/maps/index.json'])).toBe(
      'local-assets/maps/',
    );
    expect(findMapsRoot(['maps/index.json', 'maps/0/map.json'])).toBe('maps/');
    expect(findMapsRoot(['index.json'])).toBe('');
    expect(findMapsRoot(['a/b/index.json', 'a/index.json'])).toBe('a/');
    expect(findMapsRoot(['maps/0/map.json'])).toBeNull();
  });

  it('reads picked files relative to the maps folder and frees its object URLs', async () => {
    const created: string[] = [];
    const revoked: string[] = [];
    const src = importedAssetSource(
      [
        { path: 'local-assets/maps/index.json', file: blob('{"maps":[2]}') },
        { path: 'local-assets/maps/2/map.json', file: blob(text(fakeMap())) },
        { path: 'local-assets/maps/2/background.png', file: blob('png') },
      ],
      {
        create: () => {
          const url = `blob:${created.length}`;
          created.push(url);
          return url;
        },
        revoke: (url) => revoked.push(url),
      },
    );
    expect(src).not.toBeNull();
    expect(await loadMapIndex(src!)).toEqual({ ok: true, value: [2] });
    const loaded = await loadMapPreview(src!, 2);
    expect(loaded.ok && loaded.value.backgroundUrl).toBe('blob:0');
    await src!.imageUrl('2/background.png');
    expect(created).toEqual(['blob:0']);
    expect(await src!.readText('../secret')).toBeNull();
    src!.dispose();
    expect(revoked).toEqual(['blob:0']);
  });

  it('needs an index.json', () => {
    expect(importedAssetSource([{ path: 'x/map.json', file: blob('{}') }])).toBeNull();
  });
});
