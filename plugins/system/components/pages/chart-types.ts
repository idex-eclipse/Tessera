export interface SeriesDef<T> {
  label: string;
  color: string;
  unit: string;
  get: (p: T) => number | null;
}

export interface ChartDef<T> {
  id: string;
  title: string;
  /** фиксированный диапазон 0..100 */
  fixed: boolean;
  /** формат значения в шапке для безразмерных серий (unit === '') */
  fmt?: (v: number) => string;
  /** знаков после запятой на оси Y (по умолчанию 0) */
  axisDecimals?: number;
  series: SeriesDef<T>[];
}
