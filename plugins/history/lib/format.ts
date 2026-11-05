export interface DurationUnits {
  h: string;
  m: string;
  s: string;
}

export interface FilamentUnits {
  m: string;
  km: string;
}

const DEFAULT_DURATION_UNITS: DurationUnits = { h: 'h', m: 'm', s: 's' };
const DEFAULT_FILAMENT_UNITS: FilamentUnits = { m: 'm', km: 'km' };

/** Единицы приходят из i18n плагина; по умолчанию — латиница (тесты, фолбэк). */
export function formatDuration(sec?: number, u: DurationUnits = DEFAULT_DURATION_UNITS): string {
  if (typeof sec !== 'number' || !Number.isFinite(sec) || sec <= 0) return '—';
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return `${h}${u.h} ${m}${u.m} ${r}${u.s}`;
  if (m > 0) return `${m}${u.m} ${r}${u.s}`;
  return `${r}${u.s}`;
}

// Moonraker хранит филамент в мм
export function formatFilament(mm?: number, u: FilamentUnits = DEFAULT_FILAMENT_UNITS): string {
  if (typeof mm !== 'number' || !Number.isFinite(mm) || mm <= 0) return '—';
  const m = mm / 1000;
  if (m >= 1000) return `${(m / 1000).toFixed(2)} ${u.km}`;
  return `${m.toFixed(2)} ${u.m}`;
}
