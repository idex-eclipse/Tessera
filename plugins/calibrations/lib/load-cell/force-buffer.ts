/**
 * Time-window buffer of the load cell trace (times in seconds, one value each).
 *
 * The chart shows the last `windowSeconds`; `maxPoints` caps memory when the sensor is
 * fast. Old points are dropped in chunks: a `shift()` per push (as the shared
 * temperature buffer does) would be O(n) at hundreds of samples per second.
 */
export class ForceBuffer {
  #times: number[] = [];
  #values: number[] = [];
  /** Index of the first live point; points before it are waiting to be spliced out. */
  #head = 0;

  constructor(
    readonly windowSeconds = 30,
    readonly maxPoints = 6000,
  ) {}

  get length(): number {
    return this.#times.length - this.#head;
  }

  push(time: number, value: number): void {
    this.#times.push(time);
    this.#values.push(value);

    const cutoff = time - this.windowSeconds;
    while (this.#head < this.#times.length && this.#times[this.#head]! < cutoff) this.#head++;
    const over = this.length - this.maxPoints;
    if (over > 0) this.#head += over;

    // Compact when the dead prefix grows past the live part.
    if (this.#head > 1024 && this.#head > this.length) {
      this.#times.splice(0, this.#head);
      this.#values.splice(0, this.#head);
      this.#head = 0;
    }
  }

  clear(): void {
    this.#times = [];
    this.#values = [];
    this.#head = 0;
  }

  /** Live times (a copy: uPlot keeps the arrays it is given). */
  times(): number[] {
    return this.#times.slice(this.#head);
  }

  values(): number[] {
    return this.#values.slice(this.#head);
  }

  last(): { time: number; value: number } | null {
    const i = this.#times.length - 1;
    return i >= this.#head ? { time: this.#times[i]!, value: this.#values[i]! } : null;
  }

  /** Min / max of the live window, null when empty. */
  range(): { min: number; max: number } | null {
    if (this.length === 0) return null;
    let min = Infinity;
    let max = -Infinity;
    for (let i = this.#head; i < this.#values.length; i++) {
      const v = this.#values[i]!;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    return { min, max };
  }
}
