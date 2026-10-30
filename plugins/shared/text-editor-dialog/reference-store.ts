/**
 * Загрузка Klipper Config_Reference.md через Moonraker (файловый root `docs`).
 *
 * Файл ~230 КБ: держим разобранный индекс в памяти на сессию по принтеру
 * (в localStorage такое не кладут), параллельные запросы схлопываем. Ошибки не
 * кешируем — следующий клик пробует снова.
 */
import type { PluginApi } from '../../../plugin-sdk/src/types';
import { createFileOps, type FileRef } from '../file-table/file-ops';
import { parseReference, type ReferenceIndex } from './config-reference';

export const REFERENCE_REF: FileRef = { root: 'docs', path: 'Config_Reference.md', isDir: false };

const cache = new Map<string, ReferenceIndex>();
const inflight = new Map<string, Promise<ReferenceIndex>>();

export function clearReferenceCache(): void {
  cache.clear();
  inflight.clear();
}

// async: синхронные исключения api.moonraker() (нет активного принтера) становятся reject
export async function loadReference(api: PluginApi): Promise<ReferenceIndex> {
  const key = api.printer?.id ?? '';
  const hit = cache.get(key);
  if (hit) return hit;

  let pending = inflight.get(key);
  if (!pending) {
    pending = createFileOps(api)
      .readText(REFERENCE_REF)
      .then((text) => {
        const index = parseReference(text);
        cache.set(key, index);
        return index;
      })
      .finally(() => {
        inflight.delete(key);
      });
    inflight.set(key, pending);
  }
  return pending;
}

export type ReferenceErrorKind = 'unavailable' | 'error';

/** 401/403/404 — root `docs` не отдаётся или файла нет; остальное — обычная ошибка. */
export function classifyReferenceError(e: unknown): { kind: ReferenceErrorKind; message: string } {
  const message = e instanceof Error ? e.message : String(e);
  return /HTTP (401|403|404)\b/.test(message)
    ? { kind: 'unavailable', message }
    : { kind: 'error', message };
}
