import Phaser from 'phaser';
import type { Board } from '@richman/shared';
import type { DisplayModel } from '../model/display';
import { BoardView } from '../render/board-view';
import type { Rect } from '../render/layout';

const MARGIN = 16;

export class GameScene extends Phaser.Scene {
  private boardView: BoardView | null = null;
  private pendingModel: DisplayModel | null = null;

  constructor(private readonly board: Board) {
    super('game');
  }

  create(): void {
    this.boardView = new BoardView(this, this.board, this.boardArea());
    if (this.pendingModel) this.boardView.show(this.pendingModel);
    this.scale.on(Phaser.Scale.Events.RESIZE, () => this.boardView?.resize(this.boardArea()));
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
