export interface KeyConfig {
  apiKey: string;
  limit: number;
  windowMs: number;
  burst: number;
}

export type Decision =
  | { allowed: true; limit: number; remaining: number; resetMs: number }
  | { allowed: false; limit: number; remaining: 0; resetMs: number; retryAfterSec: number };

/** Sliding window log limiter with burst capacity (spec 01). */
export class SlidingWindowLimiter {
  readonly #configs = new Map<string, KeyConfig>();
  readonly #logs = new Map<string, number[]>();

  /** Replaces every key config and empties every log (ALG-03). */
  configure(keys: readonly KeyConfig[]): void {
    this.#configs.clear();
    this.#logs.clear();
    for (const key of keys) {
      this.#configs.set(key.apiKey, { ...key });
      this.#logs.set(key.apiKey, []);
    }
  }

  isConfigured(apiKey: string): boolean {
    return this.#configs.has(apiKey);
  }

  /** Evaluates one request at time `now`; `null` means the key is unknown (ALG-10). */
  evaluate(apiKey: string, now: number): Decision | null {
    const config = this.#configs.get(apiKey);
    if (config === undefined) return null;

    const { limit, burst, windowMs } = config;
    const capacity = limit + burst;

    // ALG-04: prune wherever the timestamp sits; the log is unordered after a backwards clock.
    const log = (this.#logs.get(apiKey) ?? []).filter((t) => t > now - windowMs);
    const count = log.length; // ALG-05
    const allowed = count < capacity; // ALG-06
    if (allowed) log.push(now); // ALG-07
    this.#logs.set(apiKey, log);

    // ALG-13: capacity >= 1, so the log is never empty here.
    const resetMs = smallest(log) + windowMs - now;
    const remaining = capacity - log.length; // ALG-12

    if (allowed) return { allowed, limit: capacity, remaining, resetMs };
    return { allowed, limit: capacity, remaining: 0, resetMs, retryAfterSec: ceilDiv(resetMs, 1000) };
  }
}

function smallest(values: readonly number[]): number {
  let min = Number.POSITIVE_INFINITY;
  for (const value of values) if (value < min) min = value;
  return min;
}

/** Exact integer ceil(a / b); floating-point division can round wrongly near 2^53. */
function ceilDiv(a: number, b: number): number {
  return Number((BigInt(a) + BigInt(b) - 1n) / BigInt(b));
}
