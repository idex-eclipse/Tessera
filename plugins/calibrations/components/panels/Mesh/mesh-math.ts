/**
 * Bed-mesh math: статистика, физическая сетка, цветовая шкала.
 * Чистые функции, тестируемы без принтера.
 */

export interface MeshStats {
  min: number;
  max: number;
  /** max - min */
  variance: number;
}

export function computeStats(matrix: number[][]): MeshStats | null {
  let min = Infinity;
  let max = -Infinity;

  for (const row of matrix) {
    for (const v of row) {
      if (typeof v !== 'number' || !Number.isFinite(v)) continue;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }

  if (min === Infinity || max === -Infinity) return null;
  return { min, max, variance: max - min };
}

export interface SurfaceGrid {
  /** физические координаты X (колонки) */
  xs: number[];
  /** физические координаты Y (строки) */
  ys: number[];
  /** values[row][col] */
  values: number[][];
}

/**
 * Строки matrix = Y, колонки = X (как в дампе bed_mesh).
 * Границы — из mesh_min / mesh_max.
 */
export function buildGrid(
  meshMin: [number, number] | null,
  meshMax: [number, number] | null,
  matrix: number[][],
): SurfaceGrid | null {
  if (!meshMin || !meshMax) return null;

  const rows = matrix.length;
  if (rows === 0) return null;
  const cols = matrix[0]?.length ?? 0;
  if (cols === 0) return null;

  return {
    xs: linspace(meshMin[0], meshMax[0], cols),
    ys: linspace(meshMin[1], meshMax[1], rows),
    values: matrix,
  };
}

function linspace(a: number, b: number, n: number): number[] {
  if (n <= 1) return [(a + b) / 2];
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    out.push(a + ((b - a) * i) / (n - 1));
  }
  return out;
}

// ------------------------------------------------------------------
// Цветовая шкала: синий (min) → красный (max)
// ------------------------------------------------------------------

export function norm(value: number, min: number, max: number): number {
  if (max <= min) return 0.5;
  return Math.min(1, Math.max(0, (value - min) / (max - min)));
}

/** t ∈ [0..1] → RGB по HSL-градиенту hue 240° → 0° */
export function deviationRgb(t: number): [number, number, number] {
  const clamped = Math.min(1, Math.max(0, t));
  const hue = (240 - 240 * clamped) / 360;
  return hslToRgb(hue, 0.85, 0.55);
}

export function deviationColor(value: number, min: number, max: number): string {
  const [r, g, b] = deviationRgb(norm(value, min, max));
  return `rgb(${r}, ${g}, ${b})`;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;

  return [
    Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    Math.round(hue2rgb(p, q, h) * 255),
    Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
  ];
}

function hue2rgb(p: number, q: number, tIn: number): number {
  let t = tIn;
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

export function formatMm(v: number, digits = 3): string {
  return `${v.toFixed(digits)} mm`;
}

export function niceTicks(min: number, max: number, count = 6): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return [min];

  const step0 = (max - min) / Math.max(1, count);
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const err = step0 / mag;
  const step = err >= 7.5 ? mag * 10 : err >= 3.5 ? mag * 5 : err >= 1.5 ? mag * 2 : mag;

  const ticks: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) {
    ticks.push(Number(v.toFixed(6)));
  }
  return ticks;
}