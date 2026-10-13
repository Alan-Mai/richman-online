import { startApp } from './app';
import './ui/styles.css';

const board = document.querySelector<HTMLElement>('#board');
const hud = document.querySelector<HTMLElement>('#hud');
const overlay = document.querySelector<HTMLElement>('#overlay');
if (board && hud && overlay) {
  startApp({ board, hud, overlay });
}
