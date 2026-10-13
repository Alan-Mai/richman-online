import Phaser from 'phaser';
import { BootScene } from './scenes/boot-scene';

function startGame(parent: HTMLElement): void {
  new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    backgroundColor: '#1d2b3a',
    scale: { mode: Phaser.Scale.RESIZE, width: '100%', height: '100%' },
    scene: [BootScene],
  });
}

/** WebGL fails to create its framebuffers at size 0 (e.g. a hidden pane), so wait for a size. */
function whenSized(element: HTMLElement, callback: () => void): void {
  const sized = () => element.clientWidth > 0 && element.clientHeight > 0;
  if (sized()) {
    callback();
    return;
  }
  const observer = new ResizeObserver(() => {
    if (sized()) {
      observer.disconnect();
      callback();
    }
  });
  observer.observe(element);
}

const parent = document.querySelector<HTMLDivElement>('#app');
if (parent) {
  whenSized(parent, () => startGame(parent));
}
