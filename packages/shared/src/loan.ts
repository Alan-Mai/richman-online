// Bank loans (docs/GAME_RULES.md §4 "貸款", §8 "貸款與破產"): how much may be borrowed or repaid,
// and when a loan falls due.
import { addDays, type CalendarDate } from './calendar';
import { isSundayOrHoliday, type HolidayRule } from './holidays';
import type { PlayerId } from './ids';
import { netWorth } from './money';
import type { GameState } from './state';
import { playerOf } from './update';

/** A loan falls due this many days after the first borrowing. */
export const LOAN_DAYS = 90;

/**
 * How much more playerId may borrow: net worth (which already takes the loan off) minus the loan,
 * or 0 once the loan reaches net worth.
 */
export function borrowLimit(state: GameState, playerId: PlayerId): number {
  return Math.max(0, netWorth(state, playerId) - playerOf(state, playerId).loan);
}

/**
 * How much playerId may repay: the loan, but no more than cash and deposit together (more is
 * refused, as the original's "not enough cash" message does).
 */
export function repayLimit(state: GameState, playerId: PlayerId): number {
  const { cash, deposit, loan } = playerOf(state, playerId);
  return Math.min(loan, cash + deposit);
}

/**
 * The due date of a first loan taken `today`: 90 days on, moved past Sundays and rest days of the
 * board's holiday table.
 */
export function loanDueDate(today: CalendarDate, holidays: readonly HolidayRule[]): CalendarDate {
  let due = addDays(today, LOAN_DAYS);
  while (isSundayOrHoliday(due, holidays)) {
    due = addDays(due, 1);
  }
  return due;
}
