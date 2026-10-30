/**
 * Чтение документов Klipper (`docs/*.md`) через Moonraker (файловый root `docs`).
 *
 * Документы большие (~80–230 КБ): разобранный результат держим в памяти на сессию по
 * ключу «принтер + файл» (в localStorage такое не кладут), параллельные запросы
 * схлопываем. Ошибки не кешируем — следующая попытка пробует снова.
 */

export interface DocHandle {
  httpBaseUrl: string;
  authToken: string | null;
}

export interface DocRequest<T> {
  /** ключ кеша: принтер + файл */
  key: string;
  /** handle нужного принтера (вызывается при реальном запросе) */
  handle: () => DocHandle;
  /** путь внутри root `docs` */
  path: string;
  parse: (text: string) => T;
}

const cache = new Map<string, unknown>();
const inflight = new Map<string, Promise<unknown>>();

export function clearDocCache(): void {
  cache.clear();
  inflight.clear();
}

function encodeSegments(p: string): string {
  return p.split('/').map(encodeURIComponent).join('/');
}

async function fetchDocText(handle: DocHandle, path: string): Promise<string> {
  const headers: Record<string, string> = handle.authToken
    ? { Authorization: `Bearer ${handle.authToken}` }
    : {};
  const url = `${handle.httpBaseUrl}/server/files/docs/${encodeSegments(path)}?t=${Date.now()}`;
  const res = await fetch(url, { cache: 'no-store', headers });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

// async: синхронные исключения handle() (нет активного принтера) становятся reject
export async function loadDoc<T>(req: DocRequest<T>): Promise<T> {
  if (cache.has(req.key)) return cache.get(req.key) as T;

  let pending = inflight.get(req.key) as Promise<T> | undefined;
  if (!pending) {
    pending = fetchDocText(req.handle(), req.path)
      .then((text) => {
        const parsed = req.parse(text);
        cache.set(req.key, parsed);
        return parsed;
      })
      .finally(() => {
        inflight.delete(req.key);
      });
    inflight.set(req.key, pending);
  }
  return pending;
}

/** 401/403/404 — root `docs` не отдаётся или файла нет; остальное — обычная ошибка. */
export function classifyDocError(e: unknown): { kind: 'unavailable' | 'error'; message: string } {
  const message = e instanceof Error ? e.message : String(e);
  return /HTTP (401|403|404)\b/.test(message)
    ? { kind: 'unavailable', message }
    : { kind: 'error', message };
}
