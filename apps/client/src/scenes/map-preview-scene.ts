// Read-only view of a converted original map: background, squares and their links.
// Wheel zooms around the pointer, dragging pans, clicking a square selects it.
import Phaser from 'phaser';
import type { MapPreview } from '../assets/map-preview';
import { loadOriginalImage } from '../render/original-texture';

const BACKGROUND_KEY = 'original-map-background';
const SQUARE_RADIUS = 10;
const MAX_ZOOM = 4;
/** Pointer movement (screen px) below which a press counts as a click, not a drag. */
const CLICK_SLOP = 5;

export interface MapPreviewHandlers {
  onSquareSelected(index: number): void;
  onLoadError(): void;
}

export class MapPreviewScene extends Phaser.Scene {
  private fitZoom = 1;
  private marker: Phaser.GameObjects.Arc | null = null;

  constructor(
    private readonly preview: MapPreview,
    private readonly backgroundUrl: string,
    private readonly handlers: MapPreviewHandlers,
  ) {
    super('map-preview');
  }

  create(): void {
    const camera = this.cameras.main;
    camera.setRoundPixels(true);
    loadOriginalImage(this, BACKGROUND_KEY, this.backgroundUrl).then(
      () => this.draw(),
      () => this.handlers.onLoadError(),
    );
  }

  private draw(): void {
    const { width, height } = this.preview.background;
    this.add.image(0, 0, BACKGROUND_KEY).setOrigin(0);

    const lines = this.add.graphics().lineStyle(3, 0xffe066, 0.9);
    const { squares } = this.preview;
    squares.forEach((sq, i) => {
      for (const j of sq.links) {
        const other = squares[j];
        if (other && j > i) lines.lineBetween(sq.x, sq.y, other.x, other.y);
      }
    });

    let pressedAt: Phaser.Math.Vector2 | null = null;
    squares.forEach((sq, i) => {
      this.add
        .circle(sq.x, sq.y, SQUARE_RADIUS, 0xff4d6d, 0.9)
        .setStrokeStyle(2, 0xffffff)
        .setInteractive({ useHandCursor: true })
        .on('pointerup', (pointer: Phaser.Input.Pointer) => {
          if (pressedAt && pointer.position.distance(pressedAt) > CLICK_SLOP) return;
          this.select(i);
        });
    });

    const camera = this.cameras.main;
    camera.setBounds(-width, -height, width * 3, height * 3);
    this.fit();
    this.scale.on(Phaser.Scale.Events.RESIZE, () => this.fit());

    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      pressedAt = pointer.position.clone();
    });
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (!pointer.isDown) return;
      camera.scrollX -= (pointer.x - pointer.prevPosition.x) / camera.zoom;
      camera.scrollY -= (pointer.y - pointer.prevPosition.y) / camera.zoom;
    });
    this.input.on(
      'wheel',
      (pointer: Phaser.Input.Pointer, _over: unknown, _dx: number, deltaY: number) => {
        const before = camera.getWorldPoint(pointer.x, pointer.y);
        const zoom = Phaser.Math.Clamp(
          camera.zoom * Math.pow(1.1, -deltaY / 100),
          this.fitZoom / 2,
          MAX_ZOOM,
        );
        camera.setZoom(zoom);
        // Keep the point under the pointer fixed while zooming.
        const after = camera.getWorldPoint(pointer.x, pointer.y);
        camera.scrollX += before.x - after.x;
        camera.scrollY += before.y - after.y;
      },
    );
  }

  /** Zooms so the whole map is visible, centred. */
  private fit(): void {
    const { width, height } = this.preview.background;
    const camera = this.cameras.main;
    this.fitZoom = Math.min(this.scale.width / width, this.scale.height / height);
    camera.setZoom(this.fitZoom);
    camera.centerOn(width / 2, height / 2);
  }

  private select(index: number): void {
    const sq = this.preview.squares[index];
    if (!sq) return;
    this.marker?.destroy();
    this.marker = this.add
      .circle(sq.x, sq.y, SQUARE_RADIUS * 2, 0xffffff, 0)
      .setStrokeStyle(4, 0x4dd2ff);
    this.handlers.onSquareSelected(index);
  }
}
