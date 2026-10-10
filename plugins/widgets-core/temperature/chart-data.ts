/**
 * Temperature-specific series composition.
 * Generic chart math lives in plugins/shared/uplot-core.
 */
import type { SeriesDef } from '../../shared/uplot-core';
import type { TemperatureSensor } from './use-temperature.svelte';

export { buildChartData, linspace, niceRange, niceStep } from '../../shared/uplot-core';
export type { ChartData, SeriesDef } from '../../shared/uplot-core';

/**
 * Which series the chart should draw:
 * - temperature line for every chartVisible sensor (default visible)
 * - target line for controlled heaters/fans (hidden together with temp line)
 * - power line for powerVisible heaters (default hidden)
 */
export function buildSeriesDefs(sensors: TemperatureSensor[]): SeriesDef[] {
  const defs: SeriesDef[] = [];

  for (const s of sensors) {
    if (s.chartVisible) {
      defs.push({
        id: `${s.name}:temp`,
        kind: 'temp',
        label: s.displayName,
        color: s.color,
        scale: 't',
      });

      if (s.kind !== 'sensor') {
        defs.push({
          id: `${s.name}:target`,
          kind: 'target',
          label: `${s.displayName} →`,
          color: s.color,
          dash: [6, 4],
          scale: 't',
        });
      }
    }

    if (s.powerVisible && s.kind !== 'sensor') {
      defs.push({
        id: `${s.name}:power`,
        kind: 'power',
        label: `${s.displayName} %`,
        color: s.color,
        dash: [4, 3],
        scale: 'p',
      });
    }
  }

  return defs;
}