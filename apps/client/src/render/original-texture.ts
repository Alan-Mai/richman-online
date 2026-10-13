// Loads an image converted from the original game as a texture with nearest-neighbour sampling, so
// pixel art stays sharp when zoomed. All original art (maps now, sprites later) goes through here.
import Phaser from 'phaser';

export function loadOriginalImage(scene: Phaser.Scene, key: string, url: string): Promise<void> {
  const useNearest = () => scene.textures.get(key).setFilter(Phaser.Textures.FilterMode.NEAREST);
  if (scene.textures.exists(key)) {
    useNearest();
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const onError = (file: Phaser.Loader.File) => {
      if (file.key !== key) return;
      scene.load.off(`filecomplete-image-${key}`, onComplete);
      reject(new Error(`could not load ${key}`));
    };
    const onComplete = () => {
      scene.load.off(Phaser.Loader.Events.FILE_LOAD_ERROR, onError);
      useNearest();
      resolve();
    };
    scene.load.once(`filecomplete-image-${key}`, onComplete);
    scene.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, onError);
    scene.load.image(key, url);
    scene.load.start();
  });
}
