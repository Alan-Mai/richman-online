import Phaser from 'phaser';
import { ENGINE_VERSION } from '@richman/shared';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('boot');
  }

  create(): void {
    const { width, height } = this.scale;
    this.add
      .text(width / 2, height / 2, `Richman Online (engine ${ENGINE_VERSION})`, {
        color: '#ffffff',
        fontSize: '24px',
      })
      .setOrigin(0.5);
  }
}
