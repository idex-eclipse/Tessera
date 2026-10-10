import { SeriesBuffer } from './series-buffer';
/**
 * Generic uPlot chart data structures.
 * Used by widgets-core/temperature-graph and calibrations/heaters.
 */

export interface SeriesDef {
  id: string;
  kind: string;  // 'temp' | 'target' | 'power' | custom
  label: string;
  color: string;
  dash?: number[];
  scale?: 't' | 'p' | string;  // temperature / power / custom
}

export interface ChartData {
  xs: number[];
  cols: Array<Array<number | null>>;
}

/**
 * Builds aligned uPlot data [xs, cols].
 * All buffers share the same tick times; shorter buffers are head-padded with null.
 * 
 * @param buffers - Map of series name → { temp: SeriesBuffer, target?: SeriesBuffer, power?: SeriesBuffer }
 * @param defs - Series definitions to render
 */
export function buildChartData(
  buffers: Map<string, { temp: SeriesBuffer; target?: SeriesBuffer; power?: SeriesBuffer }>,
  defs: SeriesDef[],
): ChartData {
  // Reference time axis: the series with the latest sample
  let ref: number[] = [];
  let bestEnd = -Infinity;

  for (const d of defs) {
    const buf = buffers.get(d.id.split(':')[0]);  // id format: "sensorName:kind"
    const t = buf?.temp?.timesArray;
    if (t && t.length > 0) {
      const end = t[t.length - 1] ?? -Infinity;
      if (end > bestEnd) {
        bestEnd = end;
        ref = t;
      }
    }
  }

  const xs = ref.slice();

  const cols = defs.map((d) => {
    const sensorName = d.id.split(':')[0];
    const buf = buffers.get(sensorName);
    
    let src: SeriesBuffer | undefined;
    if (d.kind === 'temp') src = buf?.temp;
    else if (d.kind === 'target') src = buf?.target;
    else if (d.kind === 'power') src = buf?.power;

    if (!src || src.length === 0) {
      return new Array<number | null>(xs.length).fill(null);
    }

    const times = src.timesArray;
    const vals = src.valuesArray;
    const out: Array<number | null> = new Array(xs.length).fill(null);

    // Time-based alignment with zero-order hold
    let p = 0;
    for (let i = 0; i < xs.length; i++) {
      const x = xs[i] ?? 0;

      if (x < (times[0] ?? Infinity)) {
        out[i] = null;
        continue;
      }

      while (p + 1 < times.length && (times[p + 1] ?? Infinity) <= x) {
        p++;
      }

      const v = vals[p];
      if (v === undefined) {
        out[i] = null;
        continue;
      }

      out[i] = d.kind === 'power' ? v * 100 : v;  // Power: 0..1 → 0..100%
    }

    return out;
  });

  return { xs, cols };
}

// Re-export utility functions
export { niceStep, niceRange, linspace } from './math-utils';