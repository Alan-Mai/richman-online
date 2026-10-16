// Bank loans (docs/GAME_RULES.md §4 "貸款", §8 "貸款與破產"): how much may be borrowed or repaid,
// and when a loan falls due.
import { addDays, daysBetween, type CalendarDate } from './calendar';
import { isSundayOrHoliday, type HolidayRule } from './holidays';
import type { PlayerId } from './ids';
import { netWorth } from './money';
import type { GameState } from './state';
import { playerOf } from './update';

/** A loan falls due this many days after the first borrowing. */
export const LOAN_DAYS = 90;
/** Reminders start this many days before the due date (the first one for humans only). */
export const LOAN_REMINDER_DAYS = 3;

/** A computer without a loan borrows on one draw in this many... */
export const COMPUTER_BORROW_ODDS = 10;
/** ...or whenever its cash and deposit are below this (not multiplied by the price index). */
export const COMPUTER_BORROW_BELOW = 30_000;
/** A computer repays once the due date is this few days away, if it holds 1.1 times the loan. */
export const COMPUTER_REPAY_DAYS = 6;

/**
 * A deposit after a month's interest (docs/GAME_RULES.md §2 "日" item 7): trunc(deposit × 1.1),
 * with 1.1 as a double like the original's constant (53-bit FPU). For whole deposits below 2^31
 * this equals floor(11 × deposit / 10).
 */
export function withInterest(deposit: number): number {
  return Math.trunc(deposit * 1.1);
}

/**
 * What a computer without a loan borrows when it does (docs/GAME_RULES.md §4): loanPercent of net
 * worth, rounded down. Its net worth is never negative without a loan.
 */
export function computerBorrowAmount(loanPercent: number, worth: number): number {
  return Math.trunc((loanPercent * worth) / 100);
}

/**
 * Whether a computer with a loan pays all of it back at a bank (docs/GAME_RULES.md §4): within 6
 * days of the due date with cash and deposit covering 1.1 times the loan, or with a deposit over
 * twice the loan. 1.1 × loan is a double-precision product, like the original's (53-bit FPU).
 */
export function computerRepays(
  player: { cash: number; deposit: number; loan: number; loanDue: CalendarDate },
  today: CalendarDate,
): boolean {
  const { cash, deposit, loan, loanDue } = player;
  const soon = daysBetween(today, loanDue) <= COMPUTER_REPAY_DAYS && loan * 1.1 <= cash + deposit;
  return soon || loan * 2 < deposit;
}

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
