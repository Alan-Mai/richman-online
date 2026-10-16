import type { BankDirection } from './actions';
import type { CalendarDate } from './calendar';
import type { PlayerId, TileIndex } from './ids';

/** The debt that could not be paid; amountDue is the full amount, not what was paid. */
export type BankruptcyCause =
  | { kind: 'rent'; tile: TileIndex; amountDue: number }
  | { kind: 'system'; amountDue: number }
  /** A loan repayment the borrower could not cover (docs/GAME_RULES.md §8 "貸款與破產"). */
  | { kind: 'loan'; amountDue: number };

/** One line of the month-start report. */
export type MonthlyInterest =
  { playerId: PlayerId; kind: 'interest'; amount: number } | { playerId: PlayerId; kind: 'onLoan' };

export type GameEndReason =
  | 'lastStanding'
  | 'dayLimitOrNetWorthTarget'
  /** The game had one human seat and that player went bankrupt; nobody wins. */
  | 'humanBankrupt'
  /** A bankruptcy left no human in the game; nobody wins. */
  | 'noHumansLeft';

/** What happened, in order, for the client to animate. */
export type GameEvent =
  | { type: 'TurnStarted'; playerId: PlayerId; round: number }
  /**
   * A round ended: one more day has gone by, `date` is the new calendar date, and the price index
   * was updated (maybe unchanged).
   */
  | { type: 'DayAdvanced'; day: number; date: CalendarDate; priceIndex: number }
  /** A player's first turn put them on the board, facing away from prev. */
  | { type: 'PlayerPlaced'; playerId: PlayerId; tile: TileIndex; prev: TileIndex }
  /** The player chose how many dice to roll; kept for later turns until changed. */
  | { type: 'DiceCountSet'; playerId: PlayerId; count: number }
  | { type: 'DiceRolled'; playerId: PlayerId; dice: readonly number[]; total: number }
  /** Every tile stepped on, in order, ending with the landing tile. */
  | { type: 'PlayerMoved'; playerId: PlayerId; path: readonly TileIndex[] }
  | { type: 'PropertyBought'; playerId: PlayerId; tile: TileIndex; price: number }
  | { type: 'PropertyUpgraded'; playerId: PlayerId; tile: TileIndex; level: number; cost: number }
  /** Out of the payer's cash (after any DepositWithdrawn), into the owner's deposit. */
  | {
      type: 'RentPaid';
      from: PlayerId;
      to: PlayerId;
      tile: TileIndex;
      amount: number;
      into: 'deposit';
    }
  /** Cash fell short of a payment and the rest came out of the deposit. */
  | { type: 'DepositWithdrawn'; playerId: PlayerId; amount: number }
  | {
      type: 'PlayerBankrupt';
      playerId: PlayerId;
      /** null when the debt was owed to the system. */
      creditor: PlayerId | null;
      /**
       * Goes into the creditor's deposit, like rent. A debt to the system pays no player: what the
       * debtor had left goes into the lottery pool instead.
       */
      paidToCreditor: number;
      /** Every tile the player owned, now unowned with its building level kept. */
      releasedTiles: readonly TileIndex[];
      cause: BankruptcyCause;
    }
  /** A drawn property goes under the hammer (docs/GAME_RULES.md §8). */
  | {
      type: 'AuctionStarted';
      tile: TileIndex;
      startPrice: number;
      /** Who may bid, in seat order; empty when nobody can, and AuctionUnsold follows at once. */
      bidders: readonly PlayerId[];
      /** How many drawn properties are still to be auctioned after this one. */
      remaining: number;
    }
  | { type: 'AuctionRaised'; playerId: PlayerId; raise: number; price: number }
  | { type: 'AuctionPassed'; playerId: PlayerId }
  /** shortOfCash: their turn came with less cash than the current price. */
  | { type: 'AuctionWithdrawn'; playerId: PlayerId; reason: 'chose' | 'shortOfCash' }
  /** Paid from the winner's cash into the lottery pool; the buildings stay. */
  | { type: 'AuctionWon'; playerId: PlayerId; tile: TileIndex; price: number }
  /** Nobody bought it; it stays unowned with its buildings. */
  | { type: 'AuctionUnsold'; tile: TileIndex }
  /**
   * A human reached a bank, walking over it or stopping on it, and may now move money between
   * cash and deposit (docs/GAME_RULES.md §4). A PlayerMoved ending on the bank comes first.
   */
  | { type: 'BankOpened'; playerId: PlayerId; tile: TileIndex; trigger: 'pass' | 'land' }
  /** Moved between the player's cash and deposit at a bank. */
  | { type: 'BankTransferred'; playerId: PlayerId; direction: BankDirection; amount: number }
  /**
   * A computer at a bank moved money between cash and deposit by itself (docs/GAME_RULES.md §4);
   * cash and deposit are the new amounts. Only sent when something changed.
   */
  | { type: 'BankRebalanced'; playerId: PlayerId; tile: TileIndex; cash: number; deposit: number }
  /**
   * The current player's loan falls due in `daysLeft` days (docs/GAME_RULES.md §4): 3 for humans
   * only (the original opens a reminder screen), 2 and 1 for everyone. Sent as the turn starts.
   */
  | { type: 'LoanReminder'; playerId: PlayerId; daysLeft: number }
  /**
   * The due date has come as the borrower's turn starts: the whole loan, `amount` (0 when a computer
   * already repaid), is taken back, deposit first, and the loan and due date are cleared. When
   * cash and deposit fall short, both go to 0 and PlayerBankrupt follows.
   */
  | { type: 'LoanCalledIn'; playerId: PlayerId; amount: number }
  /**
   * A new month has begun (docs/GAME_RULES.md §2 "日" item 7), right after its DayAdvanced: each
   * player still in the game, in seat order, either got 10% interest on the deposit (`amount`,
   * already added; it may be 0) or got none for having a loan.
   */
  | { type: 'MonthStarted'; players: readonly MonthlyInterest[] }
  /** A human who stopped on a bank is at its loan counter (docs/GAME_RULES.md §4). */
  | { type: 'CounterOpened'; playerId: PlayerId; tile: TileIndex }
  /** Borrowed `amount` into the deposit; loan and loanDue are the new values. */
  | {
      type: 'LoanBorrowed';
      playerId: PlayerId;
      amount: number;
      loan: number;
      loanDue: CalendarDate;
    }
  /**
   * Paid `amount` of the loan back, deposit first, then cash; loan and loanDue are the new values.
   * `by` says why: at the counter, or a computer repaying by itself (it keeps the due date).
   */
  | {
      type: 'LoanRepaid';
      playerId: PlayerId;
      amount: number;
      loan: number;
      loanDue: CalendarDate | null;
      by: 'counter' | 'computer';
    }
  | {
      type: 'GameEnded';
      /**
       * At most one player left, or the day limit or net worth target was reached as a day went
       * by (like the original, which of the two is not told apart), or a bankruptcy took out the
       * only human seat, or the last human still in the game (docs/GAME_RULES.md §1).
       */
      reason: GameEndReason;
      /** Empty when nobody is left or no human is; at most one otherwise. */
      winners: readonly PlayerId[];
      /** Every player's net worth when the game ended. */
      netWorth: Readonly<Record<PlayerId, number>>;
    };

export type GameEventType = GameEvent['type'];
