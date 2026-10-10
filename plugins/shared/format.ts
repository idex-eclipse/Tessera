export function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

export function formatDuration(sec?: number): string {
  if (!sec || !Number.isFinite(sec)) return '—';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${Math.round(sec)}s`;
}

export function formatDate(ts: number): string {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleString(undefined, {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

/**
 * Обратимое восстановление double-encoded UTF-8 (байты UTF-8, прочитанные
 * как Latin-1: «Параметр» → «ÐÐ°ÑÐ°Ð¼ÐµÑÑ»). Применяется ТОЛЬКО к строкам,
 * целиком лежащим в U+0000–U+00FF и складывающимся в валидный UTF-8 после
 * обратного преобразования; иначе строка возвращается как есть.
 */
export function tryFixMojibake(s: string): string {
  if (!s || !/^[\u0000-\u00ff]*$/.test(s)) return s;
  if (!/[\u0080-\u00ff]/.test(s)) return s; // чистая ASCII — не трогаем
  try {
    const bytes = Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff);
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return s;
  }
}