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
  VEHICLES,
  validateRuleConfig,
  type ComputerBidConfig,
  type RuleConfig,
  type RuleConfigError,
  type RuleConfigErrorReason,
  type Vehicle,
} from './config';
export {
  actorOf,
  applyAction,
  computerAction,
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
export type { BankruptcyCause, GameEndReason, GameEvent, GameEventType } from './events';
export {
  auctionStartPrice,
  buyPrice,
  netWorth,
  rentFor,
  upgradeCost,
  type NetWorthView,
  type PriceView,
} from './money';
export type { PlayerId, TileIndex } from './ids';
export type { ServerUpdate } from './protocol';
export {
  viewFor,
  type AuctionPhaseView,
  type PhaseView,
  type PlayerView,
  type TurnView,
  type Viewer,
} from './view';
export {
  createRng,
  nextInt,
  nextUint32,
  parseRngState,
  type ParseRngResult,
  type RngState,
} from './rng';
export {
  ORIGINAL_TABLE_LENGTHS,
  ORIGINAL_TABLES_VERSION,
  parseOriginalTables,
  type OriginalCharacter,
  type OriginalItem,
  type OriginalTables,
  type OriginalTablesError,
  type ParseOriginalTablesResult,
} from './tables';
export type {
  AuctionBidder,
  AuctionBidderStatus,
  AuctionPhase,
  Controller,
  GameState,
  Phase,
  PhaseKind,
  PlayerLocation,
  PlayerState,
  TileState,
  TurnState,
} from './state';
