// Reads the files written by `pnpm -F extract cli map` for the read-only preview. Only the fields
// the preview draws are checked; everything else in map.json is ignored.
import type { AssetSource } from './asset-source';

/** map.json format version this client understands (tools/extract MAP_JSON_VERSION). */
export const SUPPORTED_MAP_JSON_VERSION = 2;

export interface PreviewSquare {
  x: number;
  y: number;
  name: string;
  /** Indices of linked squares (undirected in the source data). */
  links: number[];
}

export interface MapPreview {
  map: number;
  background: { file: string; width: number; height: number };
  squares: PreviewSquare[];
}

export type MapFileError =
  | { kind: 'missing'; path: string }
  | { kind: 'notJson'; path: string }
  | { kind: 'version'; path: string; found: unknown }
  /** Written by an older converter: the fix is to run `cli map` again. */
  | { kind: 'outdated'; path: string; found: number }
  | { kind: 'invalid'; path: string; field: string };

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: MapFileError };

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isInt(value: unknown, min = 0): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** index.json: `{ maps: number[] }`, the map numbers exported so far. */
export function parseMapIndex(text: string, path = 'index.json'): Parsed<number[]> {
  const data = parseJson(text);
  if (data === undefined) return { ok: false, error: { kind: 'notJson', path } };
  if (!isObject(data) || !Array.isArray(data.maps) || !data.maps.every((n) => isInt(n))) {
    return { ok: false, error: { kind: 'invalid', path, field: 'maps' } };
  }
  return { ok: true, value: [...new Set(data.maps)].sort((a, b) => a - b) };
}

/** A plain file name next to map.json; no directories, so it cannot point elsewhere. */
function isSiblingPng(value: unknown): value is string {
  return typeof value === 'string' && /^[\w.-]+\.png$/i.test(value) && !value.startsWith('.');
}

export function parseMapPreview(text: string, path: string): Parsed<MapPreview> {
  const data = parseJson(text);
  const invalid = (field: string): Parsed<MapPreview> => ({
    ok: false,
    error: { kind: 'invalid', path, field },
  });
  if (data === undefined) return { ok: false, error: { kind: 'notJson', path } };
  if (!isObject(data)) return invalid('root');
  if (data.version !== SUPPORTED_MAP_JSON_VERSION) {
    const error: MapFileError =
      isInt(data.version, 1) && data.version < SUPPORTED_MAP_JSON_VERSION
        ? { kind: 'outdated', path, found: data.version }
        : { kind: 'version', path, found: data.version };
    return { ok: false, error };
  }
  if (!isInt(data.map)) return invalid('map');

  const bg = data.background;
  if (!isObject(bg) || !isSiblingPng(bg.file) || !isInt(bg.width, 1) || !isInt(bg.height, 1)) {
    return invalid('background');
  }
  if (!Array.isArray(data.squares)) return invalid('squares');

  const count = data.squares.length;
  const squares: PreviewSquare[] = [];
  for (const [i, raw] of data.squares.entries()) {
    if (!isObject(raw) || typeof raw.x !== 'number' || typeof raw.y !== 'number') {
      return invalid(`squares[${i}]`);
    }
    if (!Number.isFinite(raw.x) || !Number.isFinite(raw.y)) return invalid(`squares[${i}]`);
    if (typeof raw.name !== 'string') return invalid(`squares[${i}].name`);
    if (!Array.isArray(raw.links)) return invalid(`squares[${i}].links`);
    const links: number[] = [];
    for (const link of raw.links) {
      if (link === null) continue;
      if (!isInt(link) || link >= count) return invalid(`squares[${i}].links`);
      links.push(link);
    }
    squares.push({ x: raw.x, y: raw.y, name: raw.name, links });
  }
  return {
    ok: true,
    value: {
      map: data.map,
      background: { file: bg.file, width: bg.width, height: bg.height },
      squares,
    },
  };
}

export async function loadMapIndex(source: AssetSource): Promise<Parsed<number[]>> {
  const path = 'index.json';
  const text = await source.readText(path);
  return text === null
    ? { ok: false, error: { kind: 'missing', path } }
    : parseMapIndex(text, path);
}

export interface LoadedMapPreview {
  preview: MapPreview;
  backgroundUrl: string;
}

export async function loadMapPreview(
  source: AssetSource,
  map: number,
): Promise<Parsed<LoadedMapPreview>> {
  const path = `${map}/map.json`;
  const text = await source.readText(path);
  if (text === null) return { ok: false, error: { kind: 'missing', path } };
  const parsed = parseMapPreview(text, path);
  if (!parsed.ok) return parsed;
  const imagePath = `${map}/${parsed.value.background.file}`;
  const backgroundUrl = await source.imageUrl(imagePath);
  if (backgroundUrl === null) return { ok: false, error: { kind: 'missing', path: imagePath } };
  return { ok: true, value: { preview: parsed.value, backgroundUrl } };
}
