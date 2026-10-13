// AssetSource over files the player picked with <input webkitdirectory>. Nothing is uploaded:
// files are read in the browser and images are shown through object URLs.
import type { AssetSource } from './asset-source';

export interface PickedFile {
  /** Path inside the picked folder, e.g. "maps/0/map.json" (File.webkitRelativePath). */
  path: string;
  file: Blob;
}

export interface ObjectUrls {
  create(blob: Blob): string;
  revoke(url: string): void;
}

const browserUrls: ObjectUrls = {
  create: (blob) => URL.createObjectURL(blob),
  revoke: (url) => URL.revokeObjectURL(url),
};

/**
 * The maps folder is wherever the shallowest index.json is, so the player may pick either
 * local-assets/ or local-assets/maps/. Returns null when no index.json was picked.
 */
export function findMapsRoot(paths: readonly string[]): string | null {
  const roots = paths
    .map((p) => p.replaceAll('\\', '/'))
    .filter((p) => p === 'index.json' || p.endsWith('/index.json'))
    .map((p) => p.slice(0, -'index.json'.length));
  if (roots.length === 0) return null;
  return roots.reduce((best, r) => (r.split('/').length < best.split('/').length ? r : best));
}

export function importedAssetSource(
  picked: readonly PickedFile[],
  urls: ObjectUrls = browserUrls,
): AssetSource | null {
  const root = findMapsRoot(picked.map((p) => p.path));
  if (root === null) return null;
  const files = new Map<string, Blob>();
  for (const { path, file } of picked) {
    const normal = path.replaceAll('\\', '/');
    if (normal.startsWith(root)) files.set(normal.slice(root.length), file);
  }
  const created = new Map<string, string>();
  return {
    kind: 'imported',
    async readText(path) {
      const file = files.get(path);
      return file ? file.text() : null;
    },
    imageUrl(path) {
      const file = files.get(path);
      if (!file) return Promise.resolve(null);
      let url = created.get(path);
      if (url === undefined) {
        url = urls.create(file);
        created.set(path, url);
      }
      return Promise.resolve(url);
    },
    dispose() {
      created.forEach((url) => urls.revoke(url));
      created.clear();
    },
  };
}

/** Converts an <input webkitdirectory> FileList. */
export function pickedFromFileList(list: FileList): PickedFile[] {
  return [...list].map((file) => ({ path: file.webkitRelativePath || file.name, file }));
}
