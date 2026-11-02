import { afterEach, describe, expect, test, vi } from 'vitest';
import { ManualClock } from '../../src/clock.js';

describe('ManualClock', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test('ALG-01 HTTP-06: starts at 0', () => {
    expect(new ManualClock().now()).toBe(0);
  });

  test('ALG-01: never reads the system clock', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);

    expect(new ManualClock().now()).toBe(0);
  });

  test('ALG-01: returns the value it was set to', () => {
    const clock = new ManualClock();

    clock.set(1234);

    expect(clock.now()).toBe(1234);
  });

  test('ALG-15: can be set backwards', () => {
    const clock = new ManualClock();
    clock.set(1000);

    clock.set(500);

    expect(clock.now()).toBe(500);
  });
});
