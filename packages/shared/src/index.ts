// Rule engine entry point. Must stay pure and deterministic (see CLAUDE.md).
export const ENGINE_VERSION = '0.0.0';

export type { Action, ActionType } from './actions';
export {
  MAX_LINKS,
  isLinked,
  isPlaceable,
  validateBoard,
  type BlankTileDef,
  type Board,
  type BoardError,
  type Point,
  type PropertyTileDef,
  type TileLink,
  type UnsupportedTileDef,
  type TileDef,
} from './board';
export { TEST_BRANCH_BOARD } from './maps/test-branch';
export { TEST_LOOP_BOARD } from './maps/test-loop';
export {
  DEFAULT_RULE_CONFIG,
  validateRuleConfig,
  type RuleConfig,
  type RuleConfigError,
  type RuleConfigErrorReason,
} from './config';
export {
  applyAction,
  createGame,
  legalActions,
  type Result,
  type CreateGameError,
  type CreateGameResult,
  type GameSetup,
  type PlayerSetup,
} from './engine';
export type { RuleError } from './errors';
export { checkInvariants } from './invariants';
export type { BankruptcyCause, GameEvent, GameEventType } from './events';
export { buyPrice, netWorth, rentFor, upgradeCost, type PriceView } from './money';
export type { PlayerId, TileIndex } from './ids';
export type { ServerUpdate } from './protocol';
export { viewFor, type PlayerView, type Viewer } from './view';
export {
  createRng,
  nextInt,
  nextUint32,
  parseRngState,
  type ParseRngResult,
  type RngState,
} from './rng';
export type {
  GameState,
  Phase,
  PhaseKind,
  PlayerLocation,
  PlayerState,
  TileState,
  TurnState,
} from './state';
