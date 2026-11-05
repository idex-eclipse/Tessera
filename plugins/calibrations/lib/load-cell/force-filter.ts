/**
 * Display filters for the load cell force graph.
 *
 * The buffer always keeps the raw samples; a filter only changes what is drawn, so switching
 * the filter or its window is instant and loses nothing.
 *
 * Every filter returns its values on the *input* x values (one value per input sample). That
 * lets all columns share one x array, which uPlot requires, and lets the raw trace be drawn
 * underneath as just another column.
 */

export type FilterKind = 'raw' | 'average' | 'moving' | 'median' | 'envelope';

export const FILTER_KINDS: readonly FilterKind[] = ['raw', 'average', 'moving', 'median', 'envelope'];

/** Window bounds in milliseconds. The lower bound is the chart's own 20 ms resolution. */
export const FILTER_MS_MIN = 20;
export const FILTER_MS_MAX = 2000;
export const FILTER_MS_DEFAULT = 100;

export interface FilterResult {
  xs: number[];
  /** One column, or two (lower, upper) for the envelope. */
  cols: number[][];
}

/** Narrows an arbitrary stored value to a valid filter kind (`raw` when unknown). */
export function parseFilterKind(v: unknown): FilterKind {
  return FILTER_KINDS.includes(v as FilterKind) ? (v as FilterKind) : 'raw';
}

/** Clamps a window to the allowed range; non-numbers fall back to the default. */
export function clampFilterMs(ms: unknown): number {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return FILTER_MS_DEFAULT;
  return Math.min(FILTER_MS_MAX, Math.max(FILTER_MS_MIN, Math.round(ms)));
}

/**
 * Applies `kind` with a window of `ms` milliseconds to the series (`xs` in seconds, ascending).
 *
 * - `average`: mean of each fixed bin. Bin edges are anchored to absolute time (`floor(t / w)`)
 *   rather than to the first sample, so they do not drift while the window scrolls and old
 *   samples drop off the left; the newest bin is partial and simply shows what it has so far.
 * - `moving`: trailing moving average over the last `ms` (running sum, O(n)).
 * - `median`: trailing moving median; removes single-sample spikes without blurring edges.
 * - `envelope`: per-bin minimum and maximum, so the sensor noise stays visible.
 *
 * Windows trail (they never look ahead) so the live edge of the graph does not jump when a
 * new sample arrives.
 */
export function applyFilter(kind: FilterKind, ms: number, xs: number[], ys: number[]): FilterResult {
  const n = Math.min(xs.length, ys.length);
  if (kind === 'raw' || n === 0) return { xs, cols: [ys] };
  const w = clampFilterMs(ms) / 1000;
  switch (kind) {
    case 'average':
      return { xs, cols: [binStat(xs, ys, n, w, 'mean')] };
    case 'envelope':
      return { xs, cols: [binStat(xs, ys, n, w, 'min'), binStat(xs, ys, n, w, 'max')] };
    case 'moving':
      return { xs, cols: [movingAverage(xs, ys, n, w)] };
    case 'median':
      return { xs, cols: [movingMedian(xs, ys, n, w)] };
  }
}

/** Per-bin statistic, expanded back to one value per sample. */
function binStat(xs: number[], ys: number[], n: number, w: number, stat: 'mean' | 'min' | 'max'): number[] {
  const out = new Array<number>(n);
  let start = 0;
  while (start < n) {
    const bin = Math.floor(xs[start]! / w);
    let end = start;
    let sum = 0;
    let lo = Infinity;
    let hi = -Infinity;
    while (end < n && Math.floor(xs[end]! / w) === bin) {
      const v = ys[end]!;
      sum += v;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
      end++;
    }
    const value = stat === 'mean' ? sum / (end - start) : stat === 'min' ? lo : hi;
    for (let i = start; i < end; i++) out[i] = value;
    start = end;
  }
  return out;
}

function movingAverage(xs: number[], ys: number[], n: number, w: number): number[] {
  const out = new Array<number>(n);
  let lo = 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += ys[i]!;
    while (xs[i]! - xs[lo]! >= w) sum -= ys[lo++]!;
    out[i] = sum / (i - lo + 1);
  }
  return out;
}

function movingMedian(xs: number[], ys: number[], n: number, w: number): number[] {
  const out = new Array<number>(n);
  // the current window, kept sorted so the median is a lookup and updates are a binary search
  const win: number[] = [];
  const lowerBound = (v: number): number => {
    let a = 0;
    let b = win.length;
    while (a < b) {
      const m = (a + b) >> 1;
      if (win[m]! < v) a = m + 1;
      else b = m;
    }
    return a;
  };
  let lo = 0;
  for (let i = 0; i < n; i++) {
    win.splice(lowerBound(ys[i]!), 0, ys[i]!);
    while (xs[i]! - xs[lo]! >= w) {
      win.splice(lowerBound(ys[lo]!), 1);
      lo++;
    }
    const mid = win.length >> 1;
    out[i] = win.length % 2 ? win[mid]! : (win[mid - 1]! + win[mid]!) / 2;
  }
  return out;
}
