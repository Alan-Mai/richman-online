import Phaser from 'phaser';
import type { Board } from '@richman/shared';
import type { DisplayModel } from '../model/display';
import { BoardView } from '../render/board-view';
import type { Rect } from '../render/layout';
import type { AnimationStage } from '../render/phaser-animator';
import {
  DEFAULT_GAME_SPEED,
  FAST_SPEED,
  PROJECT_PACING,
  type GameSpeed,
  type Pacing,
} from '../render/timings';

const MARGIN = 16;

export interface GameSceneInput {
  /** Enter: the main action (roll, buy, upgrade). */
  onPrimary(): void;
  /** Escape: decline the pending offer. */
  onDecline(): void;
  /** D: the next dice count (the original's default key). */
  onCycleDice(): void;
  /** A tile on the board was clicked or tapped. */
  onTileSelected(tile: number): void;
}

export class GameScene extends Phaser.Scene implements AnimationStage {
  private boardView: BoardView | null = null;
  private pendingModel: DisplayModel | null = null;
  private resolveReady: (board: BoardView) => void = () => {};
  private fastKey: Phaser.Input.Keyboard.Key | null = null;
  readonly ready: Promise<BoardView>;
  /** The player's game speed setting; changes apply from the next animation. */
  gameSpeed: GameSpeed = DEFAULT_GAME_SPEED;
  /** Project values unless the original tables were imported before the game started. */
  pacing: Pacing = PROJECT_PACING;

  constructor(
    private readonly board: Board,
    private readonly handlers: GameSceneInput,
  ) {
    super('game');
    this.ready = new Promise((resolve) => {
      this.resolveReady = resolve;
    });
  }

  get phaserScene(): Phaser.Scene {
    return this;
  }

  get speed(): number {
    return this.fastKey?.isDown ? FAST_SPEED : 1;
  }

  create(): void {
    this.boardView = new BoardView(this, this.board, this.boardArea(), (tile) =>
      this.handlers.onTileSelected(tile),
    );
    if (this.pendingModel) this.boardView.show(this.pendingModel);
    this.scale.on(Phaser.Scale.Events.RESIZE, () => this.boardView?.resize(this.boardArea()));

    const keyboard = this.input.keyboard;
    if (keyboard) {
      this.fastKey = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
      keyboard.on('keydown-ENTER', () => this.handlers.onPrimary());
      keyboard.on('keydown-ESC', () => this.handlers.onDecline());
      keyboard.on('keydown-D', () => this.handlers.onCycleDice());
    }
    this.resolveReady(this.boardView);
  }

  /** Shows the model now, or as soon as the scene has been created. */
  showModel(model: DisplayModel): void {
    this.pendingModel = model;
    this.boardView?.show(model);
  }

  private boardArea(): Rect {
    const { width, height } = this.scale;
    return { x: MARGIN, y: MARGIN, width: width - 2 * MARGIN, height: height - 2 * MARGIN };
  }
}
