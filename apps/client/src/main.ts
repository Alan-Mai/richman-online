// Placeholder until Phase 3 (Phaser is added when the game scene is built).
import { ENGINE_VERSION } from '@richman/shared';

const app = document.querySelector<HTMLDivElement>('#app');
if (app) {
  app.textContent = `Richman Online (engine ${ENGINE_VERSION})`;
}
