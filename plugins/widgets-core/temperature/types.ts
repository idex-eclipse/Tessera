import type { SeriesBuffer } from '../../shared/uplot-core/series-buffer';

import type { SensorKind } from './lib/data';

export interface TemperatureSensor {
  name: string;
  displayName: string;
  kind: SensorKind;
  color: string;
  temperature: number | null;
  target: number | null;
  power: number | null;
  rate: number | null;
  speed: number | null;
  minTemp: number | null;
  maxTemp: number | null;
  chartVisible: boolean;
  powerVisible: boolean;
}

export interface SensorBuffers {
  temp: SeriesBuffer;
  target: SeriesBuffer;
  power: SeriesBuffer;
}
