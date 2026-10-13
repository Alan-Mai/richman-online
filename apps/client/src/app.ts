// App lifecycle: setup screen → one hot-seat game → result dialog → back to setup.
import Phaser from 'phaser';
import type { GameSetup } from '@richman/shared';
import { GameController } from './game-controller';
import { LocalGameHost } from './net/local-host';
import { PhaserAnimator } from './render/phaser-animator';
import { BootScene } from './scenes/boot-scene';
import { GameScene } from './scenes/game-scene';
import { GameOverDialog } from './ui/game-over';
import { Hud } from './ui/hud';
import { defaultSetupForm, type SetupForm } from './ui/setup-form';
import { renderSetupScreen } from './ui/setup-screen';

export interface AppElements {
  board: HTMLElement;
  hud: HTMLElement;
  /** Covers the game for the setup screen and the result dialog. */
  overlay: HTMLElement;
}

interface Session {
  dispose(): void;
}

function startSession(setup: GameSetup, elements: AppElements, onAgain: () => void): Session {
  const created = LocalGameHost.create(setup);
  if (!created.ok) {
    // The setup form validates everything createGame checks, so this is a client bug.
    throw new Error(`createGame rejected the setup: ${JSON.stringify(created.errors)}`);
  }
  const { host } = created;
  const { board } = setup;

  let controller: GameController | null = null;
  const act = (type: Parameters<GameController['act']>[0]) => controller?.act(type);
  const hud = new Hud(elements.hud, { board, onAct: act });
  const scene = new GameScene(board, {
    onPrimary: () => {
      const primary = controller?.available.find((type) => type !== 'decline');
      if (primary) act(primary);
    },
    onDecline: () => act('decline'),
    onTileSelected: (tile) => hud.showTile(tile),
  });
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: elements.board,
    backgroundColor: '#1d2b3a',
    scale: { mode: Phaser.Scale.RESIZE, width: '100%', height: '100%' },
    scene: [BootScene, scene],
  });
  const gameOver = new GameOverDialog(elements.overlay, { seed: setup.seed, onAgain });

  controller = new GameController(host, new PhaserAnimator(scene), [scene, hud, gameOver]);
  host.start();

  return {
    dispose: () => {
      controller?.dispose();
      game.destroy(true);
      elements.hud.replaceChildren();
    },
  };
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

export function startApp(elements: AppElements): void {
  let session: Session | null = null;
  let lastForm: SetupForm = defaultSetupForm();

  const showSetup = () => {
    session?.dispose();
    session = null;
    elements.overlay.hidden = false;
    renderSetupScreen(elements.overlay, lastForm, (setup, form) => {
      lastForm = form;
      elements.overlay.hidden = true;
      elements.overlay.replaceChildren();
      whenSized(elements.board, () => {
        session = startSession(setup, elements, showSetup);
      });
    });
    elements.overlay.querySelector('select')?.focus();
  };
  showSetup();
}
