import { describe, expect, it } from 'vitest';

import { buildChartData, buildSeriesDefs } from './chart-data';
import { SeriesBuffer } from '../../shared/uplot-core/series-buffer';
import type { TemperatureSensor } from './use-temperature.svelte';

function makeSensor(overrides: Partial<TemperatureSensor> = {}): TemperatureSensor {
  return {
    name: 'extruder',
    displayName: 'Extruder',
    kind: 'heater',
    color: '#ff6d00',
    temperature: 25,
    target: 0,
    power: 0.5,
    rate: 0,
    chartVisible: true,
    powerVisible: false,
    ...overrides,
  };
}

function makeBuffers(
  times: number[],
  temps: number[],
  powers?: number[],
  targets?: number[],
) {
  const temp = new SeriesBuffer();
  const power = new SeriesBuffer();
  const target = new SeriesBuffer();

  times.forEach((t, i) => {
    temp.push(t, temps[i] ?? 0);
    if (powers) power.push(t, powers[i] ?? 0);
    if (targets) target.push(t, targets[i] ?? 0);
  });

  return { temp, power, target };
}

describe('chart-data / buildSeriesDefs', () => {
  it('builds temp + target series for visible heaters', () => {
    const defs = buildSeriesDefs([makeSensor()]);
    expect(defs.map((d) => d.kind)).toEqual(['temp', 'target']);
  });

  it('hides temp and target when chartVisible is false', () => {
    const defs = buildSeriesDefs([makeSensor({ chartVisible: false })]);
    expect(defs).toHaveLength(0);
  });

  it('adds power series only when powerVisible and not passive', () => {
    const withPower = makeSensor({ powerVisible: true });
    const passive = makeSensor({
      name: 'temperature_sensor host',
      kind: 'sensor',
      powerVisible: true,
    });

    const defs = buildSeriesDefs([withPower, passive]);

    expect(defs.map((d) => d.id)).toEqual([
      'extruder:temp',
      'extruder:target',
      'extruder:power',
      'temperature_sensor host:temp',
    ]);
  });
});

describe('chart-data / buildChartData', () => {
  it('keeps targets as-is and converts power to percent', () => {
    const times = [1, 2, 3];
    const buffers = new Map([
      ['extruder', makeBuffers(times, [20, 21, 22], [0.5, 0.6, 0.7], [50, 55, 60])],
    ]);

    const defs = buildSeriesDefs([makeSensor({ powerVisible: true })]);
    const data = buildChartData(buffers, defs);

    expect(data.xs).toEqual([1, 2, 3]);
    expect(data.cols[0]).toEqual([20, 21, 22]);      // temp
    expect(data.cols[1]).toEqual([50, 55, 60]);      // target
    expect(data.cols[2]).toEqual([50, 60, 70]);      // power, %
  });

  it('head-pads shorter buffers with null', () => {
    const buffers = new Map<string, ReturnType<typeof makeBuffers>>([
      ['extruder', makeBuffers([1, 2, 3], [20, 21, 22])],
      ['heater_bed', makeBuffers([3], [30])],
    ]);

    const defs = buildSeriesDefs([
      makeSensor(),
      makeSensor({ name: 'heater_bed', displayName: 'Heater Bed' }),
    ]);

    const data = buildChartData(buffers, defs);

    expect(data.xs).toEqual([1, 2, 3]);
    // порядок: extruder:temp, extruder:target, heater_bed:temp, heater_bed:target
    expect(data.cols[2]).toEqual([null, null, 30]);
  });

  it('aligns series with different sample rates by time (zero-order hold)', () => {
    const buffers = new Map([
      ['extruder', makeBuffers([1, 2, 3, 4, 5, 6], [20, 21, 22, 23, 24, 25])],
      ['temperature_sensor host', makeBuffers([2, 4, 6], [40, 41, 42])],
    ]);

    const defs = buildSeriesDefs([
      makeSensor(),
      makeSensor({
        name: 'temperature_sensor host',
        kind: 'sensor',
        displayName: 'Host',
      }),
    ]);

    const data = buildChartData(buffers, defs);

    expect(data.xs).toEqual([1, 2, 3, 4, 5, 6]);
    // host temp — последняя серия
    expect(data.cols[2]).toEqual([null, 40, 40, 41, 41, 42]);
  });
});