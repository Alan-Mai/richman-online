import { describe, expect, it } from 'vitest';
import { rebalance } from './bank';

/** A day in the middle of the month, where the target is cashPercent as is. */
const MID = 15;

describe('rebalance', () => {
  it('leaves money alone within 0.25 of the target', () => {
    expect(rebalance(5000, 5000, 50, MID)).toEqual({ cash: 5000, deposit: 5000 });
    // 0.7499 - 0.5 is just under 0.25.
    expect(rebalance(7499, 2501, 50, MID)).toEqual({ cash: 7499, deposit: 2501 });
  });

  it('moves to the target from 0.25 off, either way', () => {
    expect(rebalance(1000, 9000, 50, MID)).toEqual({ cash: 5000, deposit: 5000 });
    expect(rebalance(9000, 1000, 50, MID)).toEqual({ cash: 5000, deposit: 5000 });
    // Exactly 0.25 off counts.
    expect(rebalance(3, 1, 50, MID)).toEqual({ cash: 2, deposit: 2 });
  });

  it('always moves when out of cash', () => {
    // 0.1 off only, but no cash: trunc(100 × 0.1f) = 10.
    expect(rebalance(0, 100, 10, MID)).toEqual({ cash: 10, deposit: 90 });
  });

  it('aims 1.5 times higher on days 1-7 and half as high from day 26', () => {
    expect(rebalance(1000, 9000, 50, 7)).toEqual({ cash: 7500, deposit: 2500 });
    expect(rebalance(1000, 9000, 50, 8)).toEqual({ cash: 5000, deposit: 5000 });
    expect(rebalance(9000, 1000, 50, 25)).toEqual({ cash: 5000, deposit: 5000 });
    expect(rebalance(9000, 1000, 50, 26)).toEqual({ cash: 2500, deposit: 7500 });
  });

  it('turns a target of 1 or more into 0.9f and 0 into 0.1f, leaving the rest', () => {
    // 70% × 1.5 = 1.05 -> 0.9f = 0.899999976..., so 1000 gives 899, not 900.
    expect(rebalance(0, 1000, 70, 1)).toEqual({ cash: 899, deposit: 101 });
    // 0 -> 0.1f = 0.100000001...: 100.
    expect(rebalance(0, 1000, 0, MID)).toEqual({ cash: 100, deposit: 900 });
    // 95% is not clamped to 0.9: 0.95f = 0.949999988... gives 949.
    expect(rebalance(0, 1000, 95, MID)).toEqual({ cash: 949, deposit: 51 });
  });

  it('rounds total × target to double precision before rounding down, like the original FPU', () => {
    // The exact product is 214748366.99999998...; the original's FPU (53-bit precision) and a
    // double both round it to 214748367.
    expect(rebalance(0, 2_147_483_638, 10, MID)).toEqual({
      cash: 214_748_367,
      deposit: 2_147_483_638 - 214_748_367,
    });
  });

  it('changes nothing with no money at all', () => {
    expect(rebalance(0, 0, 50, MID)).toEqual({ cash: 0, deposit: 0 });
  });
});
