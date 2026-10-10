import { describe, expect, it } from 'vitest';

import { buildTargetGcode, classifySensor, displayName, sensorSortKey } from './data';
import { SeriesBuffer } from '../../shared/uplot-core/series-buffer';

describe('temperature / classifySensor', () => {
  it('classifies heaters', () => {
    expect(classifySensor('extruder')).toBe('heater');
    expect(classifySensor('extruder1')).toBe('heater');
    expect(classifySensor('heater_bed')).toBe('heater');
    expect(classifySensor('heater_generic chamber')).toBe('heater');
  });

  it('classifies fans', () => {
    expect(classifySensor('temperature_fan nevermore')).toBe('fan');
  });

  it('classifies passive sensors', () => {
    expect(classifySensor('temperature_sensor host')).toBe('sensor');
    expect(classifySensor('temperature_host')).toBe('sensor');
    expect(classifySensor('temperature_mcu')).toBe('sensor');
  });

  it('rejects non-temperature objects', () => {
    expect(classifySensor('fan')).toBeNull();
    expect(classifySensor('print_stats')).toBeNull();
    expect(classifySensor('toolhead')).toBeNull();
  });
});

describe('temperature / displayName', () => {
  it('prettifies names', () => {
    expect(displayName('extruder')).toBe('Extruder');
    expect(displayName('extruder1')).toBe('Extruder1');
    expect(displayName('heater_bed')).toBe('Heater Bed');
    expect(displayName('temperature_sensor host')).toBe('Host');
    expect(displayName('temperature_mcu')).toBe('MCU');
    expect(displayName('heater_generic chamber')).toBe('Chamber');
  });
});

describe('temperature / buildTargetGcode', () => {
  it('builds heater gcode', () => {
    expect(buildTargetGcode('extruder', 'heater', 60)).toBe(
      'SET_HEATER_TEMPERATURE HEATER=extruder TARGET=60',
    );
    expect(buildTargetGcode('heater_bed', 'heater', 55)).toBe(
      'SET_HEATER_TEMPERATURE HEATER=heater_bed TARGET=55',
    );
    expect(buildTargetGcode('heater_generic chamber', 'heater', 45)).toBe(
      'SET_HEATER_TEMPERATURE HEATER=chamber TARGET=45',
    );
  });

  it('builds temperature_fan gcode', () => {
    expect(buildTargetGcode('temperature_fan nevermore', 'fan', 40)).toBe(
      'SET_TEMPERATURE_FAN_TARGET FAN=nevermore TARGET=40',
    );
  });

  it('returns null for passive sensors', () => {
    expect(buildTargetGcode('temperature_sensor host', 'sensor', 30)).toBeNull();
  });
});

describe('temperature / sensorSortKey', () => {
  it('orders extruders, bed, heaters, fans, sensors', () => {
    const order = [
      sensorSortKey('extruder', 'heater'),
      sensorSortKey('heater_bed', 'heater'),
      sensorSortKey('heater_generic x', 'heater'),
      sensorSortKey('temperature_fan x', 'fan'),
      sensorSortKey('temperature_sensor x', 'sensor'),
    ];

    for (let i = 1; i < order.length; i += 1) {
      const prev = order[i - 1];
      const curr = order[i];

      if (prev === undefined || curr === undefined) continue;

      expect(curr).toBeGreaterThan(prev);
    }
  });
});

describe('temperature / SeriesBuffer', () => {
  it('computes rate of change', () => {
    const buf = new SeriesBuffer();

    for (let t = 0; t <= 10; t++) {
      buf.push(t, 20 + t * 0.1); // +0.1 per second
    }

    const rate = buf.rate(5);
    expect(rate).not.toBeNull();
    expect(rate!).toBeCloseTo(0.1, 5);
  });

  it('trims by time window', () => {
    const buf = new SeriesBuffer(60);

    for (let t = 0; t <= 100; t++) {
      buf.push(t, t);
    }

    // Only last 60 seconds kept
    expect(buf.timesArray[0]).toBeGreaterThanOrEqual(40);
  });

  it('returns null rate with insufficient data', () => {
    const buf = new SeriesBuffer();
    buf.push(0, 20);
    expect(buf.rate()).toBeNull();
  });
});