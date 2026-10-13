// Plays GameEvents on the board with tweens. Durations are divided by the scene's current speed
// (holding Space speeds playback up).
import Phaser from 'phaser';
import type { GameEvent, PlayerId, Point } from '@richman/shared';
import { formatMoney, t } from '../i18n';
import type { DisplayModel } from '../model/display';
import type { Animator } from '../model/event-queue';
import { FONT_FAMILY, TEXT_RESOLUTION } from '../theme';
import type { BoardView } from './board-view';
import { DURATIONS } from './timings';

export interface AnimationStage {
  readonly phaserScene: Phaser.Scene;
  /** Resolves once the scene has been created. */
  readonly ready: Promise<BoardView>;
  /** Playback speed multiplier, read before every animation. */
  readonly speed: number;
  showModel(model: DisplayModel): void;
}

export class PhaserAnimator implements Animator {
  constructor(private readonly stage: AnimationStage) {}

  async play(event: GameEvent, before: DisplayModel, after: DisplayModel): Promise<void> {
    const board = await this.stage.ready;
    switch (event.type) {
      case 'TurnStarted':
        return this.pulse(board, event.playerId);
      case 'DiceRolled':
        return this.rollDice(board, event.dice);
      case 'PlayerMoved':
        return this.walk(board, event.playerId, before, event.path);
      case 'PassBonusReceived':
        return this.floatAtPlayer(
          board,
          event.playerId,
          `+${formatMoney(event.amount)}`,
          '#7CFC9A',
        );
      case 'DepositWithdrawn':
        return this.floatAtPlayer(
          board,
          event.playerId,
          `${t('hud.deposit')} -${formatMoney(event.amount)}`,
          '#ffd27f',
        );
      case 'PropertyBought':
      case 'PropertyUpgraded': {
        this.stage.showModel(after);
        const cost = event.type === 'PropertyBought' ? event.price : event.cost;
        await Promise.all([
          this.floatAt(board.tileCenter(event.tile), `-${formatMoney(cost)}`, '#ff8a8a'),
          this.wait(DURATIONS.property),
        ]);
        return;
      }
      case 'RentPaid':
        await Promise.all([
          this.floatAtPlayer(board, event.from, `-${formatMoney(event.amount)}`, '#ff8a8a'),
          this.floatAtPlayer(board, event.to, `+${formatMoney(event.amount)}`, '#7CFC9A'),
        ]);
        return;
      case 'PlayerBankrupt':
        this.stage.showModel(after);
        await this.floatAtPlayer(board, event.playerId, t('hud.bankrupt'), '#ff5050');
        return this.wait(DURATIONS.bankrupt - DURATIONS.float);
      case 'GameEnded':
        return this.wait(DURATIONS.gameEnd);
    }
  }

  private duration(ms: number): number {
    return ms / Math.max(1, this.stage.speed);
  }

  private wait(ms: number): Promise<void> {
    const delay = this.duration(ms);
    if (delay <= 0) return Promise.resolve();
    return new Promise((resolve) =>
      this.stage.phaserScene.time.delayedCall(delay, () => resolve()),
    );
  }

  private tween(config: Phaser.Types.Tweens.TweenBuilderConfig): Promise<void> {
    return new Promise((resolve) => {
      this.stage.phaserScene.tweens.add({ ...config, onComplete: () => resolve() });
    });
  }

  private pulse(board: BoardView, playerId: PlayerId): Promise<void> {
    const token = board.token(playerId);
    if (!token) return this.wait(DURATIONS.turnStart);
    const base = token.scaleX;
    return this.tween({
      targets: token,
      scale: base * 1.35,
      yoyo: true,
      duration: this.duration(DURATIONS.turnStart / 2),
      ease: 'Sine.easeInOut',
    });
  }

  private async rollDice(board: BoardView, dice: readonly number[]): Promise<void> {
    const scene = this.stage.phaserScene;
    const center = this.boardCenter();
    const size = board.tileSize * 0.6;
    const gap = size * 0.25;
    const startX = center.x - ((dice.length - 1) * (size + gap)) / 2;
    const faces = dice.map((value, i) => {
      const x = startX + i * (size + gap);
      const box = scene.add
        .rectangle(x, center.y, size, size, 0xffffff)
        .setStrokeStyle(3, 0x1d2b3a)
        .setDepth(10);
      const text = scene.add
        .text(x, center.y, String(value), {
          color: '#1d2b3a',
          fontFamily: FONT_FAMILY,
          fontSize: `${Math.round(size * 0.6)}px`,
          fontStyle: 'bold',
          resolution: TEXT_RESOLUTION,
        })
        .setOrigin(0.5)
        .setDepth(11);
      return { box, text, value };
    });

    // Cosmetic tumbling before the real faces are shown; the result came from the host.
    const rollMs = this.duration(DURATIONS.diceRoll);
    const flips = Math.max(1, Math.round(rollMs / 70));
    for (let i = 0; i < flips; i++) {
      for (const f of faces) {
        f.text.setText(String(Phaser.Math.Between(1, Math.max(6, f.value))));
        f.box.setAngle(Phaser.Math.Between(-15, 15));
      }
      await this.wait(DURATIONS.diceRoll / flips);
    }
    for (const f of faces) {
      f.text.setText(String(f.value));
      f.box.setAngle(0);
    }
    await this.wait(DURATIONS.diceHold);
    for (const f of faces) {
      f.box.destroy();
      f.text.destroy();
    }
  }

  private async walk(
    board: BoardView,
    playerId: PlayerId,
    before: DisplayModel,
    path: readonly number[],
  ): Promise<void> {
    const token = board.token(playerId);
    if (!token) return;
    const start = before.players.find((p) => p.id === playerId)?.position;
    if (start !== undefined) {
      const at = board.tokenPosition(playerId, start);
      token.setPosition(at.x, at.y);
    }
    const hop = board.tileSize * 0.15;
    for (const tile of path) {
      const to = board.tokenPosition(playerId, tile);
      await Promise.all([
        this.tween({
          targets: token,
          x: to.x,
          duration: this.duration(DURATIONS.step),
          ease: 'Linear',
        }),
        this.tween({
          targets: token,
          y: { from: token.y, to: to.y - hop },
          duration: this.duration(DURATIONS.step / 2),
          ease: 'Quad.easeOut',
        }).then(() =>
          this.tween({
            targets: token,
            y: to.y,
            duration: this.duration(DURATIONS.step / 2),
            ease: 'Quad.easeIn',
          }),
        ),
      ]);
    }
  }

  private floatAtPlayer(
    board: BoardView,
    playerId: PlayerId,
    text: string,
    color: string,
  ): Promise<void> {
    const token = board.token(playerId);
    return this.floatAt(token ? { x: token.x, y: token.y } : this.boardCenter(), text, color);
  }

  private floatAt(at: Point, text: string, color: string): Promise<void> {
    const scene = this.stage.phaserScene;
    const label = scene.add
      .text(at.x, at.y, text, {
        color,
        fontFamily: FONT_FAMILY,
        fontSize: '20px',
        fontStyle: 'bold',
        stroke: '#000000',
        strokeThickness: 4,
        resolution: TEXT_RESOLUTION,
      })
      .setOrigin(0.5)
      .setDepth(20);
    return this.tween({
      targets: label,
      y: at.y - 40,
      alpha: { from: 1, to: 0 },
      duration: this.duration(DURATIONS.float),
      ease: 'Cubic.easeOut',
    }).then(() => {
      label.destroy();
    });
  }

  private boardCenter(): Point {
    const { width, height } = this.stage.phaserScene.scale;
    return { x: width / 2, y: height / 2 };
  }
}
