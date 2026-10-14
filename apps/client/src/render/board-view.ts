// Draws the board, ownership, house levels (owned or not) and player tokens with placeholder shapes.
import Phaser from 'phaser';
import { buyPrice, type Board, type Point, type TileIndex } from '@richman/shared';
import { formatMoney } from '../i18n';
import type { DisplayModel } from '../model/display';
import { BOARD_COLORS, FONT_FAMILY, TEXT_RESOLUTION, cssColor, playerColor } from '../theme';
import { layoutBoard, type BoardLayout, type Rect } from './layout';

/** Below these tile sizes (screen px) names and prices are not drawn. */
const MIN_TILE_FOR_NAME = 48;
const MIN_TILE_FOR_PRICE = 72;

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
  private readonly priceLayer: Phaser.GameObjects.Container;
  private readonly ownerLayer: Phaser.GameObjects.Container;
  readonly tokenLayer: Phaser.GameObjects.Container;
  private readonly tokens = new Map<string, Phaser.GameObjects.Container>();
  private seats = new Map<string, number>();
  private model: DisplayModel | null = null;
  /** Tile size when the tokens were drawn; tokens are scaled relative to it. */
  private tokenBaseSize = 1;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly board: Board,
    area: Rect,
    private readonly onTileSelected: (tile: TileIndex) => void = () => {},
  ) {
    this.tileLayer = scene.add.container().setDepth(0);
    this.priceLayer = scene.add.container().setDepth(0);
    this.ownerLayer = scene.add.container().setDepth(1);
    this.tokenLayer = scene.add.container().setDepth(2);
    this.layout = layoutBoard(this.positions(), area);
    this.tokenBaseSize = this.tileSize;
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
    // Tokens are rescaled rather than recreated so running tweens keep their targets.
    this.tokens.forEach((token) => token.setScale(this.tileSize / this.tokenBaseSize));
    if (this.model) this.show(this.model);
  }

  /** Screen centre of a tile. */
  tileCenter(tile: TileIndex): Point {
    return this.layout.toScreen(this.board.tiles[tile]?.pos ?? { x: 0, y: 0 });
  }

  /** Straight-line distance between two tiles in board units. */
  distance(a: TileIndex, b: TileIndex): number {
    const p = this.board.tiles[a]?.pos ?? { x: 0, y: 0 };
    const q = this.board.tiles[b]?.pos ?? { x: 0, y: 0 };
    return Math.hypot(q.x - p.x, q.y - p.y);
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

  /** Redraws ownership, prices and tokens to match the model. */
  show(model: DisplayModel): void {
    this.model = model;
    this.seats = new Map(model.players.map((p, i) => [p.id, i]));
    this.drawOwnership(model);
    this.drawPrices(model);
    for (const player of model.players) {
      const token = this.tokens.get(player.id) ?? this.createToken(player.id);
      // Players are placed on their first turn; until then they have no token on the board.
      token.setVisible(player.tile !== null);
      if (player.tile === null) continue;
      const at = this.tokenPosition(player.id, player.tile);
      token.setPosition(at.x, at.y).setAlpha(player.bankrupt ? 0.3 : 1);
    }
  }

  private positions(): Point[] {
    return this.board.tiles.map((t) => t.pos);
  }

  private get fontSize(): number {
    return Math.max(9, Math.round(this.tileSize * 0.15));
  }

  private drawTiles(): void {
    const size = this.tileSize * 0.92;
    const { fontSize } = this;
    this.board.tiles.forEach((tile, i) => {
      const { x, y } = this.tileCenter(i);
      const fill = tile.kind === 'property' ? BOARD_COLORS.property : BOARD_COLORS.blank;
      const rect = this.scene.add
        .rectangle(x, y, size, size, fill)
        .setStrokeStyle(Math.max(1, size * 0.02), BOARD_COLORS.tileBorder)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => this.onTileSelected(i));
      this.tileLayer.add(rect);
      // Small tiles (narrow screens) drop text; tapping a tile shows its details in the HUD.
      if (this.tileSize < MIN_TILE_FOR_NAME) return;
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
      this.tileLayer.add(name);
    });
  }

  /** The current buy price (price index and buildings included) on each property. */
  private drawPrices(model: DisplayModel): void {
    this.priceLayer.removeAll(true);
    if (this.tileSize < MIN_TILE_FOR_PRICE) return;
    const size = this.tileSize * 0.92;
    const view = { ...model, board: this.board };
    this.board.tiles.forEach((tile, i) => {
      if (tile.kind !== 'property') return;
      const { x, y } = this.tileCenter(i);
      const price = this.scene.add
        .text(x, y + size * 0.3, formatMoney(buyPrice(view, i)), {
          color: cssColor(BOARD_COLORS.text),
          fontSize: `${Math.round(this.fontSize * 0.85)}px`,
          fontFamily: FONT_FAMILY,
          resolution: TEXT_RESOLUTION,
        })
        .setOrigin(0.5);
      this.priceLayer.add(price);
    });
  }

  private drawOwnership(model: DisplayModel): void {
    this.ownerLayer.removeAll(true);
    const size = this.tileSize * 0.92;
    model.tiles.forEach((tile, i) => {
      if (tile.owner === null && tile.level === 0) return;
      const { x, y } = this.tileCenter(i);
      // An owner's colour band; an unowned property keeps the buildings of a bankrupt owner.
      if (tile.owner !== null) {
        const color = playerColor(this.seats.get(tile.owner) ?? 0);
        this.ownerLayer.add(this.scene.add.rectangle(x, y - size * 0.42, size, size * 0.16, color));
      }
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
    const radius = this.tokenBaseSize * 0.15;
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
    const token = this.scene.add
      .container(0, 0, [circle, label])
      .setScale(this.tileSize / this.tokenBaseSize);
    this.tokenLayer.add(token);
    this.tokens.set(playerId, token);
    return token;
  }
}
