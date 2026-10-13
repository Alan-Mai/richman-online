import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { localAssetsPlugin } from './vite/local-assets';

/** Converted maps written by `pnpm -F extract cli map`; never imported or bundled. */
const MAPS_DIR = fileURLToPath(new URL('../../local-assets/maps', import.meta.url));

export default defineConfig({
  plugins: [localAssetsPlugin(MAPS_DIR)],
  build: {
    // Phaser alone is about 1.2 MB minified; one chunk is fine for a game client.
    chunkSizeWarningLimit: 2000,
  },
});
