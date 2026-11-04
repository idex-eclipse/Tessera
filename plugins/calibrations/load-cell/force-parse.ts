/**
 * Parsers for the Klipper load cell bulk streams, as `handle.klippyStream` delivers them.
 * Ported from the tessera-ext `pa-tester` plugin: the chart code of a remote Lit plugin
 * cannot be imported, but the stream format is the same.
 */

export type ForceUnit = 'g' | 'counts';

export interface ForceSample {
  /** Printer monotonic clock, seconds. Used only for the x axis. */
  time: number;
  value: number;
}

export interface ForceBatch {
  unit: ForceUnit;
  samples: ForceSample[];
}

export interface TapTrace {
  /** Seconds since the first sample of the tap. */
  times: number[];
  /** Force in grams, one value per time. */
  force: number[];
}

function num(x: unknown): number | null {
  return typeof x === 'number' && Number.isFinite(x) ? x : null;
}

/**
 * `load_cell/dump_force` batch: `{ data: [[time, force_g | null, counts, tare | null], …] }`.
 * `force_g` is null until the load cell is calibrated; then the trace is `counts − tare`
 * and the unit becomes 'counts'. Malformed rows are skipped, nothing throws.
 */
export function parseForceBatch(params: unknown): ForceBatch {
  const rows = (params as { data?: unknown } | null)?.data;
  if (!Array.isArray(rows)) return { unit: 'g', samples: [] };

  let calibrated = true;
  const raw: Array<{ time: number; g: number | null; counts: number | null; tare: number }> = [];
  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    const time = num(row[0]);
    if (time === null) continue;
    const g = num(row[1]);
    if (g === null) calibrated = false;
    raw.push({ time, g, counts: num(row[2]), tare: num(row[3]) ?? 0 });
  }

  const unit: ForceUnit = calibrated ? 'g' : 'counts';
  const samples: ForceSample[] = [];
  for (const r of raw) {
    const value = unit === 'g' ? r.g : r.counts === null ? null : r.counts - r.tare;
    if (value !== null) samples.push({ time: r.time, value });
  }
  return { unit, samples };
}

/**
 * Averages samples into bins of `binSeconds`: the sensor runs at tens to hundreds of Hz,
 * the chart needs a point every few tens of milliseconds. A bin is stamped with the time
 * of its last sample.
 */
export function binSamples(samples: readonly ForceSample[], binSeconds: number): ForceSample[] {
  if (binSeconds <= 0 || samples.length === 0) return samples.slice();
  const out: ForceSample[] = [];
  let start = samples[0]!.time;
  let sum = 0;
  let n = 0;
  let lastTime = start;
  for (const s of samples) {
    if (s.time - start >= binSeconds && n > 0) {
      out.push({ time: lastTime, value: sum / n });
      start = s.time;
      sum = 0;
      n = 0;
    }
    sum += s.value;
    n++;
    lastTime = s.time;
  }
  if (n > 0) out.push({ time: lastTime, value: sum / n });
  return out;
}

/**
 * `load_cell_probe/dump_taps` message: `{ tap: { time: number[], force: number[], … } }`.
 * Only `time` and `force` are documented, so only those are read. Returns null for a
 * malformed or empty tap; the x axis is rebased to the first sample.
 */
export function parseTap(params: unknown): TapTrace | null {
  const tap = (params as { tap?: { time?: unknown; force?: unknown } } | null)?.tap;
  if (!tap || !Array.isArray(tap.time) || !Array.isArray(tap.force)) return null;
  const n = Math.min(tap.time.length, tap.force.length);
  const times: number[] = [];
  const force: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = num(tap.time[i]);
    const f = num(tap.force[i]);
    if (t === null || f === null) continue;
    times.push(t);
    force.push(f);
  }
  if (times.length === 0) return null;
  const t0 = times[0]!;
  return { times: times.map((t) => t - t0), force };
}
