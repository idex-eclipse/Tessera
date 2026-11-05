/** Форматирование значений датчиков — общее для таблицы виджета и popover датчика. */

export function fmtTemp(t: number | null): string {
  return t == null ? '—' : `${t.toFixed(1)}°C`;
}

/** `offLabel` — локализованное «выкл» для мощности ≤ 0. */
export function fmtPower(p: number | null, offLabel: string): string {
  if (p == null) return '';
  if (p <= 0) return offLabel;
  return `${Math.round(p * 100)}%`;
}

export function fmtRate(r: number | null): string {
  if (r == null || !Number.isFinite(r)) return '+0.0°C/s';
  const sign = r >= 0 ? '+' : '';
  return `${sign}${r.toFixed(1)}°C/s`;
}
