// Where converted assets come from. Paths are relative to the converted maps folder
// (local-assets/maps/ as written by `pnpm -F extract cli map`), e.g. "index.json", "0/map.json".

export interface AssetSource {
  readonly kind: 'dev' | 'imported';
  /** File contents as text, or null when the file is missing. */
  readText(path: string): Promise<string | null>;
  /** A URL an <img> or Phaser loader can use, or null when the file is missing. */
  imageUrl(path: string): Promise<string | null>;
  /** Frees anything the source holds (object URLs). */
  dispose(): void;
}

export const DEV_ASSET_PREFIX = '/local-assets/maps/';

function devUrl(path: string): string {
  return DEV_ASSET_PREFIX + path.split('/').map(encodeURIComponent).join('/');
}

/**
 * Reads local-assets/maps/ through the dev server's middleware (apps/client/vite/local-assets.ts).
 * Only exists in `vite` dev; production builds have no such route.
 */
export function devAssetSource(
  fetchFn: typeof fetch = (input, init) => fetch(input, init),
): AssetSource {
  const exists = async (url: string, method: 'GET' | 'HEAD') => {
    try {
      const response = await fetchFn(url, { method, cache: 'no-store' });
      return response.ok ? response : null;
    } catch {
      return null;
    }
  };
  return {
    kind: 'dev',
    async readText(path) {
      const response = await exists(devUrl(path), 'GET');
      return response ? response.text() : null;
    },
    async imageUrl(path) {
      const url = devUrl(path);
      return (await exists(url, 'HEAD')) ? url : null;
    },
    dispose() {},
  };
}
