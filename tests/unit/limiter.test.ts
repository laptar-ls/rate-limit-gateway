import { describe, expect, test } from 'vitest';
import { SlidingWindowLimiter, type KeyConfig } from '../../src/limiter.js';

function key(apiKey: string, limit: number, burst: number, windowMs: number): KeyConfig {
  return { apiKey, limit, burst, windowMs };
}

function limiterWith(...keys: KeyConfig[]): SlidingWindowLimiter {
  const limiter = new SlidingWindowLimiter();
  limiter.configure(keys);
  return limiter;
}

describe('SlidingWindowLimiter', () => {
  test('ALG-06 ALG-11 ALG-12 ALG-13 ALG-14: EX-01 burst extends capacity to limit + burst', () => {
    const limiter = limiterWith(key('k', 2, 1, 1000));

    expect(limiter.evaluate('k', 0)).toEqual({ allowed: true, limit: 3, remaining: 2, resetMs: 1000 });
    expect(limiter.evaluate('k', 0)).toEqual({ allowed: true, limit: 3, remaining: 1, resetMs: 1000 });
    expect(limiter.evaluate('k', 0)).toEqual({ allowed: true, limit: 3, remaining: 0, resetMs: 1000 });
    expect(limiter.evaluate('k', 0)).toEqual({
      allowed: false,
      limit: 3,
      remaining: 0,
      resetMs: 1000,
      retryAfterSec: 1,
    });
  });

  test('ALG-04: EX-02 a timestamp exactly T - windowMs leaves the window', () => {
    const limiter = limiterWith(key('k', 2, 1, 1000));
    for (let i = 0; i < 3; i++) limiter.evaluate('k', 0);

    expect(limiter.evaluate('k', 999)).toEqual({
      allowed: false,
      limit: 3,
      remaining: 0,
      resetMs: 1,
      retryAfterSec: 1,
    });
    expect(limiter.evaluate('k', 1000)).toEqual({ allowed: true, limit: 3, remaining: 2, resetMs: 1000 });
  });

  test('ALG-04 ALG-05 ALG-13: EX-03 the window slides', () => {
    const limiter = limiterWith(key('k', 2, 0, 1000));

    expect(limiter.evaluate('k', 0)).toEqual({ allowed: true, limit: 2, remaining: 1, resetMs: 1000 });
    expect(limiter.evaluate('k', 500)).toEqual({ allowed: true, limit: 2, remaining: 0, resetMs: 500 });
    expect(limiter.evaluate('k', 999)).toEqual({
      allowed: false,
      limit: 2,
      remaining: 0,
      resetMs: 1,
      retryAfterSec: 1,
    });
    expect(limiter.evaluate('k', 1000)).toEqual({ allowed: true, limit: 2, remaining: 0, resetMs: 500 });
    expect(limiter.evaluate('k', 1001)).toEqual({
      allowed: false,
      limit: 2,
      remaining: 0,
      resetMs: 499,
      retryAfterSec: 1,
    });
  });

  test('ALG-07: EX-04 denied requests are not recorded', () => {
    const limiter = limiterWith(key('k', 1, 0, 1000));

    expect(limiter.evaluate('k', 0)?.allowed).toBe(true);
    expect(limiter.evaluate('k', 500)?.allowed).toBe(false);
    expect(limiter.evaluate('k', 1000)).toEqual({ allowed: true, limit: 1, remaining: 0, resetMs: 1000 });
  });

  test.each([
    { now: 0, resetMs: 2500, retryAfterSec: 3 },
    { now: 1499, resetMs: 1001, retryAfterSec: 2 },
    { now: 1500, resetMs: 1000, retryAfterSec: 1 },
    { now: 2499, resetMs: 1, retryAfterSec: 1 },
  ])('ALG-14: EX-05 retry after rounds reset up to whole seconds (T = $now)', ({ now, resetMs, retryAfterSec }) => {
    const limiter = limiterWith(key('k', 1, 0, 2500));
    limiter.evaluate('k', 0);

    expect(limiter.evaluate('k', now)).toEqual({ allowed: false, limit: 1, remaining: 0, resetMs, retryAfterSec });
  });

  test('ALG-06 ALG-11: EX-06 burst 0 means capacity equals limit', () => {
    const limiter = limiterWith(key('k', 2, 0, 1000));

    const decisions = [limiter.evaluate('k', 0), limiter.evaluate('k', 0), limiter.evaluate('k', 0)];

    expect(decisions.map((d) => d?.allowed)).toEqual([true, true, false]);
    expect(decisions.map((d) => d?.limit)).toEqual([2, 2, 2]);
  });

  test('ALG-08: requests at the same T are counted separately', () => {
    const limiter = limiterWith(key('k', 3, 0, 1000));

    const remaining = [0, 1, 2].map(() => limiter.evaluate('k', 42)?.remaining);

    expect(remaining).toEqual([2, 1, 0]);
  });

  test('ALG-09: EX-07 keys are isolated', () => {
    const limiter = limiterWith(key('a', 1, 0, 1000), key('b', 1, 0, 1000));

    expect(limiter.evaluate('a', 0)?.allowed).toBe(true);
    expect(limiter.evaluate('b', 0)?.allowed).toBe(true);
    expect(limiter.evaluate('a', 0)?.allowed).toBe(false);
  });

  test('ALG-15: EX-08 timestamps later than T stay in the window when the clock moves backwards', () => {
    const limiter = limiterWith(key('k', 1, 0, 1000));
    limiter.evaluate('k', 1000);

    expect(limiter.evaluate('k', 500)).toEqual({
      allowed: false,
      limit: 1,
      remaining: 0,
      resetMs: 1500,
      retryAfterSec: 2,
    });
  });

  test('ALG-13 ALG-15: oldest is the smallest timestamp, not the first recorded one', () => {
    const limiter = limiterWith(key('k', 2, 0, 1000));
    limiter.evaluate('k', 1000);

    expect(limiter.evaluate('k', 500)).toEqual({ allowed: true, limit: 2, remaining: 0, resetMs: 1000 });
  });

  test('ALG-03: EX-09 configure empties all logs', () => {
    const limiter = limiterWith(key('k', 1, 0, 1000));
    limiter.evaluate('k', 0);

    limiter.configure([key('k', 1, 0, 1000)]);

    expect(limiter.evaluate('k', 0)).toEqual({ allowed: true, limit: 1, remaining: 0, resetMs: 1000 });
  });

  test('ALG-03: configure removes keys that are not in the new set', () => {
    const limiter = limiterWith(key('a', 1, 0, 1000));

    limiter.configure([key('b', 1, 0, 1000)]);

    expect(limiter.isConfigured('a')).toBe(false);
    expect(limiter.evaluate('a', 0)).toBeNull();
    expect(limiter.isConfigured('b')).toBe(true);
  });

  test('ALG-10: EX-10 an unknown key is not evaluated', () => {
    const limiter = limiterWith(key('a', 1, 0, 1000));

    expect(limiter.isConfigured('zzz')).toBe(false);
    expect(limiter.evaluate('zzz', 0)).toBeNull();
    expect(limiter.evaluate('a', 0)).toEqual({ allowed: true, limit: 1, remaining: 0, resetMs: 1000 });
  });

  test('ALG-04 ALG-13 ALG-15: EX-11 pruning works on an unordered log', () => {
    const limiter = limiterWith(key('k', 2, 0, 1000));

    expect(limiter.evaluate('k', 1000)).toEqual({ allowed: true, limit: 2, remaining: 1, resetMs: 1000 });
    expect(limiter.evaluate('k', 200)).toEqual({ allowed: true, limit: 2, remaining: 0, resetMs: 1000 });
    expect(limiter.evaluate('k', 1250)).toEqual({ allowed: true, limit: 2, remaining: 0, resetMs: 750 });
  });

  test('ALG-04 ALG-15: EX-12 pruned timestamps do not come back when the clock moves back', () => {
    const limiter = limiterWith(key('k', 2, 0, 1000));
    limiter.evaluate('k', 0);
    limiter.evaluate('k', 0);
    limiter.evaluate('k', 1000);

    expect(limiter.evaluate('k', 500)).toEqual({ allowed: true, limit: 2, remaining: 0, resetMs: 1000 });
  });

  test('ALG-02 ALG-06 ALG-11: EX-13 burst-only capacity when limit is 0', () => {
    const limiter = limiterWith(key('k', 0, 2, 1000));

    expect(limiter.evaluate('k', 0)).toEqual({ allowed: true, limit: 2, remaining: 1, resetMs: 1000 });
    expect(limiter.evaluate('k', 0)).toEqual({ allowed: true, limit: 2, remaining: 0, resetMs: 1000 });
    expect(limiter.evaluate('k', 0)).toEqual({
      allowed: false,
      limit: 2,
      remaining: 0,
      resetMs: 1000,
      retryAfterSec: 1,
    });
  });

  test('ALG-13: reset stays exact at the largest allowed values', () => {
    const max = 2 ** 52 - 1;
    const limiter = limiterWith(key('k', 1, 0, max));

    expect(limiter.evaluate('k', max)).toEqual({ allowed: true, limit: 1, remaining: 0, resetMs: max });
    expect(limiter.evaluate('k', max)).toEqual({
      allowed: false,
      limit: 1,
      remaining: 0,
      resetMs: max,
      retryAfterSec: Math.ceil(max / 1000),
    });
  });

  test('ALG-11 ALG-12: limit and remaining stay exact at the largest allowed values', () => {
    const max = 2 ** 52 - 1;
    const limiter = limiterWith(key('k', max, max, 1000));

    expect(limiter.evaluate('k', 0)).toEqual({
      allowed: true,
      limit: 2 * max,
      remaining: 2 * max - 1,
      resetMs: 1000,
    });
  });
});
