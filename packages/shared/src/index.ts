// Rule engine entry point. Must stay pure and deterministic (see CLAUDE.md).
export const ENGINE_VERSION = '0.0.0';

export type { Action, ActionType } from './actions';
export type { BlankTileDef, Board, Point, PropertyTileDef, TileDef } from './board';
export {
  DEFAULT_RULE_CONFIG,
  validateRuleConfig,
  type RuleConfig,
  type RuleConfigError,
  type RuleConfigErrorReason,
  type WinCondition,
} from './config';
export type { RuleError } from './errors';
export type { GameEvent, GameEventType } from './events';
export type { PlayerId, TileIndex } from './ids';
export type { RngState } from './rng';
export type {
  Direction,
  GameState,
  Phase,
  PhaseKind,
  PlayerState,
  TileState,
  TurnState,
} from './state';
