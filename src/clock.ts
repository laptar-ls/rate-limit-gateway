/** The gateway clock (ALG-01). It starts at 0 and only moves when it is set. */
export class ManualClock {
  #now = 0;

  now(): number {
    return this.#now;
  }

  /** Any valid time, including one earlier than the current value (ALG-15). */
  set(now: number): void {
    this.#now = now;
  }
}
