// Placeholder look (original to this project, not from the original game).

/** One colour per seat, as 0xRRGGBB. */
export const PLAYER_COLORS = [0xe05252, 0x4a7fd6, 0x3fae6a, 0xe0b23c] as const;

export function playerColor(seat: number): number {
  return PLAYER_COLORS[seat % PLAYER_COLORS.length]!;
}

export function cssColor(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

export const BOARD_COLORS = {
  background: 0x1d2b3a,
  property: 0xf3ead7,
  blank: 0xb9c8d8,
  start: 0xf6d36b,
  tileBorder: 0x2c3e50,
  text: 0x1d2b3a,
} as const;

export const FONT_FAMILY =
  'system-ui, "Microsoft JhengHei", "PingFang TC", "Noto Sans TC", sans-serif';

/** Text is rasterised at device resolution so it stays sharp on high-DPI screens. */
export const TEXT_RESOLUTION = window.devicePixelRatio || 1;
