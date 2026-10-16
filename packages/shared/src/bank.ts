// Banks (docs/GAME_RULES.md §4): how a computer moves money between cash and deposit by itself.

const f32 = Math.fround;

/**
 * A computer at a bank, passing or stopping (docs/GAME_RULES.md §4): it aims for cashPercent of
 * cash + deposit as cash, more early in the month and less late, and only moves money when far off
 * the target or out of cash. The share of cash and the target are single-precision values like the
 * original's; no randomness.
 */
export function rebalance(
  cash: number,
  deposit: number,
  cashPercent: number,
  dayOfMonth: number,
): { cash: number; deposit: number } {
  const total = cash + deposit;
  // The original divides 0 by 0 here and ends up with 0 and 0, so nothing changes.
  if (total === 0) {
    return { cash, deposit };
  }
  const share = f32(cash / total);
  let target = f32(cashPercent / 100);
  if (dayOfMonth <= 7) {
    target = f32(target * 1.5);
  } else if (dayOfMonth >= 26) {
    target = f32(target * 0.5);
  }
  // Only the ends are replaced: 0.95 stays 0.95.
  if (target >= 1) {
    target = f32(0.9);
  } else if (target <= 0) {
    target = f32(0.1);
  }
  // Both are single precision, so the double difference is exact.
  const off = share - target;
  if (off < 0.25 && off > -0.25 && cash !== 0) {
    return { cash, deposit };
  }
  const kept = floorTimes(total, target);
  return { cash: kept, deposit: total - kept };
}

/**
 * floor(n × x) computed exactly, for a non-negative integer n and a non-negative finite x: the
 * original multiplies in the FPU's extended precision, where the product of an integer and a
 * single-precision value is exact.
 */
function floorTimes(n: number, x: number): number {
  // x = mantissa / 2^shift with an integer mantissa; doubling is exact.
  let mantissa = x;
  let shift = 0;
  while (!Number.isInteger(mantissa)) {
    mantissa *= 2;
    shift++;
  }
  return Number((BigInt(n) * BigInt(mantissa)) >> BigInt(shift));
}
