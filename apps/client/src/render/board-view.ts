// Draws the board, ownership, house levels and player tokens with placeholder shapes.
import Phaser from 'phaser';
import type { Board, Point, TileIndex } from '@richman/shared';
import { formatMoney } from '../i18n';
import type { DisplayModel } from '../model/display';
import { BOARD_COLORS, FONT_FAMILY, cssColor, playerColor } from '../theme';
import { layoutBoard, type BoardLayout, type Rect } from './layout';

/** Text is rasterised at device resolution so it stays sharp on high-DPI screens. */
const TEXT_RESOLUTION = window.devicePixelRatio || 1;

/** Where each seat's token sits inside a tile, as a fraction of the tile size. */
const SEAT_OFFSETS: readonly Point[] = [
  { x: -0.2, y: -0.2 },
  { x: 0.2, y: -0.2 },
  { x: -0.2, y: 0.2 },
  { x: 0.2, y: 0.2 },
];

export class BoardView {
  private layout: BoardLayout;
  private readonly tileLayer: Phaser.GameObjects.Container;
  private readonly ownerLayer: Phaser.GameObjects.Container;
  readonly tokenLayer: Phaser.GameObjects.Container;
  private readonly tokens = new Map<string, Phaser.GameObjects.Container>();
  private seats = new Map<string, number>();
  private model: DisplayModel | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly board: Board,
    area: Rect,
  ) {
    this.tileLayer = scene.add.container().setDepth(0);
    this.ownerLayer = scene.add.container().setDepth(1);
    this.tokenLayer = scene.add.container().setDepth(2);
    this.layout = layoutBoard(this.positions(), area);
    this.drawTiles();
  }

  get tileSize(): number {
    return this.layout.tileSize;
  }

  /** Re-fits the board into a new area (window resize). */
  resize(area: Rect): void {
    this.layout = layoutBoard(this.positions(), area);
    this.tileLayer.removeAll(true);
    this.drawTiles();
    if (this.model) {
      this.tokens.forEach((t) => t.destroy());
      this.tokens.clear();
      this.show(this.model);
    }
  }

  /** Screen centre of a tile. */
  tileCenter(tile: TileIndex): Point {
    return this.layout.toScreen(this.board.tiles[tile]?.pos ?? { x: 0, y: 0 });
  }

  /** Where a player's token rests on a tile. */
  tokenPosition(playerId: string, tile: TileIndex): Point {
    const center = this.tileCenter(tile);
    const offset = SEAT_OFFSETS[this.seats.get(playerId) ?? 0] ?? { x: 0, y: 0 };
    return { x: center.x + offset.x * this.tileSize, y: center.y + offset.y * this.tileSize };
  }

  token(playerId: string): Phaser.GameObjects.Container | undefined {
    return this.tokens.get(playerId);
  }

  /** Redraws ownership and tokens to match the model. */
  show(model: DisplayModel): void {
    this.model = model;
    this.seats = new Map(model.players.map((p, i) => [p.id, i]));
    this.drawOwnership(model);
    for (const player of model.players) {
      const token = this.tokens.get(player.id) ?? this.createToken(player.id);
      const at = this.tokenPosition(player.id, player.position);
      token.setPosition(at.x, at.y).setAlpha(player.bankrupt ? 0.3 : 1);
    }
  }

  private positions(): Point[] {
    return this.board.tiles.map((t) => t.pos);
  }

  private drawTiles(): void {
    const size = this.tileSize * 0.92;
    const fontSize = Math.max(9, Math.round(this.tileSize * 0.15));
    this.board.tiles.forEach((tile, i) => {
      const { x, y } = this.tileCenter(i);
      const fill =
        i === this.board.start
          ? BOARD_COLORS.start
          : tile.kind === 'property'
            ? BOARD_COLORS.property
            : BOARD_COLORS.blank;
      const rect = this.scene.add
        .rectangle(x, y, size, size, fill)
        .setStrokeStyle(Math.max(1, size * 0.02), BOARD_COLORS.tileBorder);
      const name = this.scene.add
        .text(x, y - size * 0.08, tile.name, {
          color: cssColor(BOARD_COLORS.text),
          fontSize: `${fontSize}px`,
          fontFamily: FONT_FAMILY,
          resolution: TEXT_RESOLUTION,
          align: 'center',
          wordWrap: { width: size * 0.9, useAdvancedWrap: true },
        })
        .setOrigin(0.5);
      this.tileLayer.add([rect, name]);
      if (tile.kind === 'property') {
        const price = this.scene.add
          .text(x, y + size * 0.3, formatMoney(tile.price), {
            color: cssColor(BOARD_COLORS.text),
            fontSize: `${Math.round(fontSize * 0.85)}px`,
            fontFamily: FONT_FAMILY,
            resolution: TEXT_RESOLUTION,
          })
          .setOrigin(0.5);
        this.tileLayer.add(price);
      }
    });
  }

  private drawOwnership(model: DisplayModel): void {
    this.ownerLayer.removeAll(true);
    const size = this.tileSize * 0.92;
    model.tiles.forEach((tile, i) => {
      if (tile.owner === null) return;
      const color = playerColor(this.seats.get(tile.owner) ?? 0);
      const { x, y } = this.tileCenter(i);
      const band = this.scene.add.rectangle(x, y - size * 0.42, size, size * 0.16, color);
      this.ownerLayer.add(band);
      // One small house per level, left to right on the band.
      const pip = size * 0.1;
      for (let level = 0; level < tile.level; level++) {
        const px = x - size / 2 + pip * (0.9 + level * 1.4);
        this.ownerLayer.add(
          this.scene.add
            .rectangle(px, y - size * 0.42, pip, pip, 0xffffff)
            .setStrokeStyle(1, 0x000000),
        );
      }
    });
  }

  private createToken(playerId: string): Phaser.GameObjects.Container {
    const seat = this.seats.get(playerId) ?? 0;
    const radius = this.tileSize * 0.15;
    const circle = this.scene.add
      .circle(0, 0, radius, playerColor(seat))
      .setStrokeStyle(Math.max(1, radius * 0.15), 0xffffff);
    const label = this.scene.add
      .text(0, 0, String(seat + 1), {
        color: '#ffffff',
        fontSize: `${Math.round(radius * 1.1)}px`,
        fontFamily: FONT_FAMILY,
        resolution: TEXT_RESOLUTION,
        fontStyle: 'bold',
      })
      .setOrigin(0.5);
    const token = this.scene.add.container(0, 0, [circle, label]);
    this.tokenLayer.add(token);
    this.tokens.set(playerId, token);
    return token;
  }
}
