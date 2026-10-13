import Phaser from 'phaser';
import { DEFAULT_RULE_CONFIG, TEST_LOOP_BOARD } from '@richman/shared';
import { GameController } from './game-controller';
import { t } from './i18n';
import { LocalGameHost } from './net/local-host';
import { PhaserAnimator } from './render/phaser-animator';
import { BootScene } from './scenes/boot-scene';
import { GameScene } from './scenes/game-scene';

function startGame(parent: HTMLElement): void {
  // Temporary until the setup screen exists: a fixed 4-player game.
  const created = LocalGameHost.create({
    config: DEFAULT_RULE_CONFIG,
    board: TEST_LOOP_BOARD,
    players: [1, 2, 3, 4].map((n) => ({ id: `p${n}`, name: t('setup.defaultName', { n }) })),
    seed: 1,
  });
  if (!created.ok) throw new Error(JSON.stringify(created.errors));
  const { host } = created;

  let controller: GameController | null = null;
  const scene = new GameScene(TEST_LOOP_BOARD, {
    onPrimary: () => {
      const primary = controller?.available.find((type) => type !== 'decline');
      if (primary) controller?.act(primary);
    },
    onDecline: () => controller?.act('decline'),
  });
  new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    backgroundColor: '#1d2b3a',
    scale: { mode: Phaser.Scale.RESIZE, width: '100%', height: '100%' },
    scene: [BootScene, scene],
  });

  controller = new GameController(host, new PhaserAnimator(scene), [scene]);
  host.start();
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
