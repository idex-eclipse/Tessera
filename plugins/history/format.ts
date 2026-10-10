export function formatDuration(sec?: number): string {
  if (typeof sec !== 'number' || !Number.isFinite(sec) || sec <= 0) return '—';
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return `${h}h ${m}m ${r}s`;
  if (m > 0) return `${m}m ${r}s`;
  return `${r}s`;
}

// Moonraker хранит филамент в мм
export function formatFilament(mm?: number): string {
  if (typeof mm !== 'number' || !Number.isFinite(mm) || mm <= 0) return '—';
  const m = mm / 1000;
  if (m >= 1000) return `${(m / 1000).toFixed(2)} km`;
  return `${m.toFixed(2)} m`;
}