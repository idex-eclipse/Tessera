/**
 * Fixed-window time-series buffer (default 20 minutes).
 * Used for chart history and rate-of-change computation.
 */
export class SeriesBuffer {
  private times: number[] = [];
  private values: number[] = [];

  constructor(
    private windowSeconds = 1200,
    private maxPoints = 2400,
  ) {}

  push(time: number, value: number): void {
    this.times.push(time);
    this.values.push(value);

    const cutoff = time - this.windowSeconds;

    let first = this.times[0];
    while (first !== undefined && first < cutoff) {
      this.times.shift();
      this.values.shift();
      first = this.times[0];
    }

    while (this.times.length > this.maxPoints) {
      this.times.shift();
      this.values.shift();
    }
  }

  clear(): void {
    this.times.length = 0;
    this.values.length = 0;
  }

  get length(): number {
    return this.times.length;
  }

  get timesArray(): number[] {
    return this.times;
  }

  get valuesArray(): number[] {
    return this.values;
  }

  lastValue(): number | null {
    const last = this.values[this.values.length - 1];
    return last === undefined ? null : last;
  }

  /**
   * Smoothed rate of change (units per second) over the last N seconds.
   */
  rate(windowSeconds = 5): number | null {
    if (this.times.length < 2) return null;

    const lastT = this.times[this.times.length - 1];
    const lastV = this.values[this.values.length - 1];

    if (lastT === undefined || lastV === undefined) return null;

    const minT = lastT - windowSeconds;

    let idx = this.times.length - 1;
    while (idx > 0 && (this.times[idx - 1] ?? -Infinity) >= minT) idx--;

    const firstT = this.times[idx];
    const firstV = this.values[idx];

    if (firstT === undefined || firstV === undefined) return null;

    const dt = lastT - firstT;
    if (dt <= 0.0001) return null;

    return (lastV - firstV) / dt;
  }
}