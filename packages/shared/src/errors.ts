import type { PhaseKind } from './state';

/** Why applyAction rejected an action. */
export type RuleError =
  | { code: 'gameOver' }
  | { code: 'unknownPlayer' }
  | { code: 'notYourTurn' }
  | { code: 'wrongPhase'; phase: PhaseKind }
  | { code: 'insufficientFunds' };
