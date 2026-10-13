import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    // Phaser alone is about 1.2 MB minified; one chunk is fine for a game client.
    chunkSizeWarningLimit: 2000,
  },
});
