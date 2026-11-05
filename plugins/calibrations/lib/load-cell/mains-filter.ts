/**
 * Mains hum filter for the load cell force graph.
 *
 * A trailing moving average over exactly one mains period (20 ms at 50 Hz, 16.67 ms at 60 Hz)
 * is a comb filter: it nulls the mains frequency and every harmonic of it, which is what
 * hum picked up by a load cell looks like. It also passes DC and slow force changes, and it
 * costs one running sum per sample.
 *
 * It must see the sensor's own samples. The chart bins samples to 20 ms, which is already a
 * 50 Hz null but not a 60 Hz one, and leaves nothing to filter above that rate. So the live
 * source runs this filter *before* binning, and a tap trace (which arrives unbinned) is
 * filtered before the display filter.
 *
 * The filter needs several samples per mains period; a slow sensor (10 to 80 Hz) cannot
 * represent the hum at all (it aliases), so for such data the samples pass through unchanged
 * and `active` is false so the UI can say why nothing happened.
 */
import type { ForceSample } from './force-parse';

export type MainsHz = 50 | 60;

export const MAINS_HZ: readonly MainsHz[] = [50, 60];

/** Narrows a stored value to a supported mains frequency (50 when unknown). */
export function parseMainsHz(v: unknown): MainsHz {
  return v === 60 ? 60 : 50;
}

/** Fewer samples than this per period cannot average the hum out. */
const MIN_SAMPLES_PER_PERIOD = 4;

/** Tolerance for float noise at the window edge (a sample exactly one period back is out). */
const EDGE_EPS = 1e-9;

/** Streaming comb filter. Feed batches in time order; one output sample per input sample. */
export class MainsFilter {
  readonly period: number;
  #t: number[] = [];
  #v: number[] = [];
  #head = 0;
  #sum = 0;
  #lastTime: number | null = null;
  /** Smoothed time between samples, seconds; 0 until two samples were seen. */
  #spacing = 0;
  /** Sample rate reported by the sensor (`sample_rate` in its status), Hz; 0 when unknown. */
  #rate = 0;
  #active = true;

  constructor(hz: MainsHz) {
    this.period = 1 / hz;
  }

  /** False when the sensor is too slow for the filter: samples then pass through as they are. */
  get active(): boolean {
    return this.#active;
  }

  /**
   * Tells the filter the sensor's own sample rate. A known rate beats the estimate made from
   * timestamps: it is right from the first sample, even when batches hold a single one.
   * Pass null or a non-positive value to fall back to the estimate.
   */
  setSampleRate(hz: number | null): void {
    this.#rate = hz !== null && Number.isFinite(hz) && hz > 0 ? hz : 0;
  }

  /** Filters one batch (ascending times). */
  process(samples: readonly ForceSample[]): ForceSample[] {
    if (samples.length === 0) return [];

    // estimate the sample rate first so a whole batch is either filtered or passed through
    // (the estimate keeps running so it is ready if the reported rate goes away)
    for (const s of samples) {
      if (this.#lastTime !== null) {
        const dt = s.time - this.#lastTime;
        if (dt > 0 && dt < 1) this.#spacing = this.#spacing ? this.#spacing * 0.9 + dt * 0.1 : dt;
      }
      this.#lastTime = s.time;
    }
    const spacing = this.#rate ? 1 / this.#rate : this.#spacing;
    this.#active = spacing === 0 || this.period / spacing >= MIN_SAMPLES_PER_PERIOD;
    if (!this.#active) {
      this.#reset();
      return samples.slice();
    }

    const out: ForceSample[] = [];
    for (const s of samples) {
      this.#t.push(s.time);
      this.#v.push(s.value);
      this.#sum += s.value;
      while (s.time - this.#t[this.#head]! >= this.period - EDGE_EPS) this.#sum -= this.#v[this.#head++]!;
      out.push({ time: s.time, value: this.#sum / (this.#t.length - this.#head) });
    }
    // drop consumed samples now and then so the arrays stay about one period long
    if (this.#head > 1024) {
      this.#t.splice(0, this.#head);
      this.#v.splice(0, this.#head);
      this.#head = 0;
    }
    return out;
  }

  #reset(): void {
    this.#t = [];
    this.#v = [];
    this.#head = 0;
    this.#sum = 0;
  }
}

/**
 * Filters a whole series (a probing tap). Returns the filtered values and whether the
 * filter could act; when it could not, `values` is the input array itself.
 */
export function mainsFilterSeries(hz: MainsHz, xs: readonly number[], ys: readonly number[]): { values: number[]; active: boolean } {
  const n = Math.min(xs.length, ys.length);
  const filter = new MainsFilter(hz);
  const out = filter.process(Array.from({ length: n }, (_, i) => ({ time: xs[i]!, value: ys[i]! })));
  if (!filter.active) return { values: ys as number[], active: false };
  return { values: out.map((s) => s.value), active: true };
}
