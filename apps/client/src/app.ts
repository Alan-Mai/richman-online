// App lifecycle: setup screen → one hot-seat game → result dialog → back to setup, plus the
// read-only preview of converted original maps.
import Phaser from 'phaser';
import type { GameSetup } from '@richman/shared';
import { devAssetSource, type AssetSource } from './assets/asset-source';
import { loadMapPreview, type MapPreview } from './assets/map-preview';
import { GameController } from './game-controller';
import { t } from './i18n';
import { LocalGameHost } from './net/local-host';
import { PhaserAnimator } from './render/phaser-animator';
import { BootScene } from './scenes/boot-scene';
import { GameScene } from './scenes/game-scene';
import { MapPreviewScene } from './scenes/map-preview-scene';
import { GameOverDialog } from './ui/game-over';
import { Hud } from './ui/hud';
import { describeMapFileError, renderPreviewChooser } from './ui/preview-chooser';
import { PreviewPanel } from './ui/preview-panel';
import { defaultSetupForm, type SetupForm } from './ui/setup-form';
import { renderSetupScreen } from './ui/setup-screen';

export interface AppElements {
  board: HTMLElement;
  hud: HTMLElement;
  /** Covers the game for the setup screen, the map chooser and the result dialog. */
  overlay: HTMLElement;
}

interface Session {
  dispose(): void;
}

function createPhaserGame(
  parent: HTMLElement,
  scenes: Phaser.Types.Scenes.SceneType[],
): Phaser.Game {
  return new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    backgroundColor: '#1d2b3a',
    scale: { mode: Phaser.Scale.RESIZE, width: '100%', height: '100%' },
    scene: scenes,
  });
}

function startGameSession(setup: GameSetup, elements: AppElements, onAgain: () => void): Session {
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
  const game = createPhaserGame(elements.board, [BootScene, scene]);
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

function startPreviewSession(
  preview: MapPreview,
  backgroundUrl: string,
  elements: AppElements,
  onBack: (message?: string) => void,
): Session {
  const panel = new PreviewPanel(elements.hud, preview, () => onBack());
  const scene = new MapPreviewScene(preview, backgroundUrl, {
    onSquareSelected: (index) => panel.showSquare(index),
    onLoadError: () => onBack(t('preview.error.image')),
  });
  const game = createPhaserGame(elements.board, [scene]);
  return {
    dispose: () => {
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
  // The dev-server route only exists under `vite`; production builds rely on importing a folder.
  const devSource = import.meta.env.DEV ? devAssetSource() : null;
  let imported: AssetSource | null = null;

  const showOverlay = () => {
    session?.dispose();
    session = null;
    elements.overlay.hidden = false;
  };

  const showSetup = () => {
    showOverlay();
    renderSetupScreen(elements.overlay, {
      initial: lastForm,
      onStart: (setup, form) => {
        lastForm = form;
        elements.overlay.hidden = true;
        elements.overlay.replaceChildren();
        whenSized(elements.board, () => {
          session = startGameSession(setup, elements, showSetup);
        });
      },
      onPreview: () => showChooser(),
    });
    elements.overlay.querySelector('select')?.focus();
  };

  const showChooser = (message?: string) => {
    showOverlay();
    void renderPreviewChooser(elements.overlay, {
      devSource,
      imported,
      message,
      onImport: (source) => {
        imported?.dispose();
        imported = source;
      },
      onPick: (source, map) => void openPreview(source, map),
      onBack: showSetup,
    });
  };

  const openPreview = async (source: AssetSource, map: number) => {
    const loaded = await loadMapPreview(source, map);
    if (!loaded.ok) {
      showChooser(describeMapFileError(loaded.error));
      return;
    }
    elements.overlay.hidden = true;
    elements.overlay.replaceChildren();
    whenSized(elements.board, () => {
      session = startPreviewSession(
        loaded.value.preview,
        loaded.value.backgroundUrl,
        elements,
        showChooser,
      );
    });
  };

  showSetup();
}
