import type { PhaseKind } from './state';

/** Why applyAction rejected an action. */
export type RuleError =
  /** Not a well-formed Action (wrong shape, unknown type, missing playerId). */
  | { code: 'invalidAction' }
  | { code: 'gameOver' }
  | { code: 'unknownPlayer' }
  | { code: 'notYourTurn' }
  | { code: 'wrongPhase'; phase: PhaseKind }
  | { code: 'insufficientFunds' };
