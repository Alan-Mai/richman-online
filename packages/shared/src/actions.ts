import type { PlayerId } from './ids';

/** Player intents. playerId is filled in by the server from the sending connection. */
export type Action =
  | { type: 'rollDice'; playerId: PlayerId }
  /**
   * Choose how many dice to roll, 1 to the vehicle's most; on a motorbike or car only, before
   * rolling. Kept for later turns until changed (docs/GAME_RULES.md §9).
   */
  | { type: 'setDiceCount'; playerId: PlayerId; count: number }
  | { type: 'buyProperty'; playerId: PlayerId }
  | { type: 'upgradeProperty'; playerId: PlayerId }
  /** Pass on the pending buy or upgrade offer. */
  | { type: 'decline'; playerId: PlayerId }
  /** Raise the auction price by one of RuleConfig.auctionRaises. */
  | { type: 'bid'; playerId: PlayerId; raise: number }
  /** Pass this round of the auction; asked again after the next raise. */
  | { type: 'passRound'; playerId: PlayerId }
  /** Leave the auction for good. */
  | { type: 'withdraw'; playerId: PlayerId }
  /**
   * At a bank (docs/GAME_RULES.md §4): move `amount` (1 to the deposit when withdrawing, to the
   * cash when depositing) and close the bank. One transfer per visit.
   */
  | { type: 'bankTransfer'; playerId: PlayerId; direction: BankDirection; amount: number }
  /** Close the bank without moving money. */
  | { type: 'leaveBank'; playerId: PlayerId }
  /**
   * At the loan counter after stopping on a bank (docs/GAME_RULES.md §4): borrow `amount` into the
   * deposit, 1 to net worth minus the loan. Closes the counter.
   */
  | { type: 'borrow'; playerId: PlayerId; amount: number }
  /** At the loan counter: pay `amount` of the loan back, deposit first. Closes the counter. */
  | { type: 'repay'; playerId: PlayerId; amount: number }
  /** Close the loan counter without borrowing or repaying. */
  | { type: 'leaveCounter'; playerId: PlayerId };

export type ActionType = Action['type'];

/** Withdraw moves deposit into cash; deposit moves cash into the deposit. */
export type BankDirection = 'withdraw' | 'deposit';

export const BANK_DIRECTIONS: readonly BankDirection[] = ['withdraw', 'deposit'];

/** An offered bank transfer: any whole amount 1..max in that direction. */
export interface BankTransferOption {
  type: 'bankTransfer';
  playerId: PlayerId;
  direction: BankDirection;
  max: number;
}

/** An offered borrowing or repayment at the loan counter: any whole amount 1..max. */
export interface LoanOption {
  type: 'borrow' | 'repay';
  playerId: PlayerId;
  max: number;
}

/** The offers that are a range of amounts rather than one action. */
export type AmountOption = BankTransferOption | LoanOption;

/**
 * What legalActions offers: exact actions, or a range where an amount cannot be listed one by one.
 * Use allows to check an action against an offer.
 */
export type LegalAction = Exclude<Action, { type: AmountOption['type'] }> | AmountOption;

export function isAmountOption(option: LegalAction): option is AmountOption {
  return option.type === 'bankTransfer' || option.type === 'borrow' || option.type === 'repay';
}

/** The action that takes `amount` from an amount offer. */
export function actionFor(option: AmountOption, amount: number): Action {
  const { playerId } = option;
  return option.type === 'bankTransfer'
    ? { type: 'bankTransfer', playerId, direction: option.direction, amount }
    : { type: option.type, playerId, amount };
}

/** Whether `action` is what `option` offers: the same action, or an amount within the range. */
export function allows(option: LegalAction, action: Action): boolean {
  if (isAmountOption(option)) {
    return (
      action.type === option.type &&
      action.playerId === option.playerId &&
      (option.type !== 'bankTransfer' ||
        (action.type === 'bankTransfer' && action.direction === option.direction)) &&
      'amount' in action &&
      Number.isSafeInteger(action.amount) &&
      action.amount >= 1 &&
      action.amount <= option.max
    );
  }
  const offered = Object.entries(option);
  const sent = action as Record<string, unknown>;
  return (
    offered.length === Object.keys(action).length &&
    offered.every(([key, value]) => sent[key] === value)
  );
}
