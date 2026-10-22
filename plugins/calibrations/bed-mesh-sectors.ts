/**
 * Секторная математика карты стола для виджета.
 * Чистые функции без Svelte-состояния и без запросов.
 */

export interface SectorBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/**
 * Билинейная выборка из матрицы меша в точке (x, y) мм.
 * row 0 матрицы = minY (соглашение существующего рендера).
 */
export function bilinearSample(
  matrix: number[][],
  meshMin: [number, number],
  meshMax: [number, number],
  x: number,
  y: number,
): number | null {
  const rows = matrix.length;
  const cols = matrix[0]?.length ?? 0;
  if (rows < 1 || cols < 1) return null;

  const spanX = meshMax[0] - meshMin[0];
  const spanY = meshMax[1] - meshMin[1];
  if (spanX <= 0 || spanY <= 0) return null;

  const gx = clamp(((x - meshMin[0]) / spanX) * (cols - 1), 0, cols - 1);
  const gy = clamp(((y - meshMin[1]) / spanY) * (rows - 1), 0, rows - 1);

  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const x1 = Math.min(x0 + 1, cols - 1);
  const y1 = Math.min(y0 + 1, rows - 1);
  const fx = gx - x0;
  const fy = gy - y0;

  const v00 = matrix[y0]?.[x0] ?? 0;
  const v10 = matrix[y0]?.[x1] ?? 0;
  const v01 = matrix[y1]?.[x0] ?? 0;
  const v11 = matrix[y1]?.[x1] ?? 0;

  const top = v00 + (v10 - v00) * fx;
  const bottom = v01 + (v11 - v01) * fx;
  return top + (bottom - top) * fy;
}

/**
 * Среднее отклонение от 0 в секторе: равномерная выборка samples×samples
 * билинейных точек внутри bounds. Устойчиво к редкой сетке зондирования.
 */
export function sectorMean(
  matrix: number[][],
  meshMin: [number, number],
  meshMax: [number, number],
  b: SectorBounds,
  samples = 4,
): number | null {
  let sum = 0;
  let n = 0;
  for (let sy = 0; sy < samples; sy++) {
    for (let sx = 0; sx < samples; sx++) {
      const x = b.minX + ((sx + 0.5) / samples) * (b.maxX - b.minX);
      const y = b.minY + ((sy + 0.5) / samples) * (b.maxY - b.minY);
      const v = bilinearSample(matrix, meshMin, meshMax, x, y);
      if (v != null) {
        sum += v;
        n++;
      }
    }
  }
  return n > 0 ? sum / n : null;
}

/**
 * Число клеток по осям: максимальное N, при котором размер клетки
 * viewPx / N >= minCellPx (требование 3: 310px / 6 = 51.7 > 50).
 */
export function sectorCounts(
  viewPxW: number,
  viewPxH: number,
  minCellPx: number,
): { nx: number; ny: number } {
  return {
    nx: Math.max(1, Math.floor(viewPxW / minCellPx)),
    ny: Math.max(1, Math.floor(viewPxH / minCellPx)),
  };
}

/**
 * Шаг тиков оси в мм. На полной карте даёт 50 (требование 5);
 * в zoom подбирает читаемый шаг из того же ряда.
 * Условия: метка >= 30px И не менее 2 тиков на view.
 */
export function tickStep(scalePxPerMm: number, spanMm: number): number {
  const candidates = [50, 20, 10, 5, 2, 1].filter((s) => spanMm / s >= 2);
  const list = candidates.length > 0 ? candidates : [50];
  return list.find((s) => s * scalePxPerMm >= 30) ?? list[0];
}

/** Формат значения в клетке: знак + без хвостовых нулей (-0.2, +0.3, 0). */
export function fmtSector(v: number): string {
  if (Math.abs(v) < 5e-4) return '0';
  const trimmed = String(parseFloat(Math.abs(v).toFixed(3)));
  return `${v > 0 ? '+' : '-'}${trimmed}`;
}