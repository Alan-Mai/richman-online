import Phaser from 'phaser';
import type { Board } from '@richman/shared';
import type { DisplayModel } from '../model/display';
import { BoardView } from '../render/board-view';
import type { Rect } from '../render/layout';
import type { AnimationStage } from '../render/phaser-animator';
import { FAST_SPEED } from '../render/timings';

const MARGIN = 16;

export interface GameSceneKeys {
  /** Enter: the main action (roll, buy, upgrade). */
  onPrimary(): void;
  /** Escape: decline the pending offer. */
  onDecline(): void;
}

export class GameScene extends Phaser.Scene implements AnimationStage {
  private boardView: BoardView | null = null;
  private pendingModel: DisplayModel | null = null;
  private resolveReady: (board: BoardView) => void = () => {};
  private fastKey: Phaser.Input.Keyboard.Key | null = null;
  readonly ready: Promise<BoardView>;

  constructor(
    private readonly board: Board,
    private readonly keys: GameSceneKeys,
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
    this.boardView = new BoardView(this, this.board, this.boardArea());
    if (this.pendingModel) this.boardView.show(this.pendingModel);
    this.scale.on(Phaser.Scale.Events.RESIZE, () => this.boardView?.resize(this.boardArea()));

    const keyboard = this.input.keyboard;
    if (keyboard) {
      this.fastKey = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
      keyboard.on('keydown-ENTER', () => this.keys.onPrimary());
      keyboard.on('keydown-ESC', () => this.keys.onDecline());
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
