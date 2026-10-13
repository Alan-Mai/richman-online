import Phaser from 'phaser';

/** Entry scene; placeholder art is drawn with shapes, so there is nothing to load yet. */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('boot');
  }

  create(): void {
    this.scene.start('game');
  }
}
