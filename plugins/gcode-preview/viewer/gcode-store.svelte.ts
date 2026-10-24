import type { PluginApi } from '../../../plugin-sdk/src/types';

import { parseGcodeAsync } from './parse-client';
import type { ParsedGcode } from './parse-gcode';

export type GcodeEntry =
  | { status: 'loading' }
  | { status: 'ok'; parsed: ParsedGcode }
  | { status: 'error'; message: string };

/** Разобранные файлы тяжёлые (типизированные массивы по всем сегментам) — держим немного. */
const MAX_ENTRIES = 6;

let byFile = $state<Record<string, GcodeEntry>>({});
/** Порядок использования (последний — самый свежий) для вытеснения. */
const order: string[] = [];

/** Ключ кэша: файл с одинаковым путём на разных принтерах — разные файлы. */
function keyOf(printerId: string, path: string): string {
  return `${printerId}\u0000${path}`;
}

function touch(k: string): void {
  const i = order.indexOf(k);
  if (i !== -1) order.splice(i, 1);
  order.push(k);
  while (order.length > MAX_ENTRIES) {
    const old = order.shift();
    if (old !== undefined) delete byFile[old];
  }
}

/**
 * Загружает и разбирает файл, если его ещё нет в кэше. Идемпотентно. Реактивно читает
 * только api.printer.id (вызов из $effect перезапускается при смене принтера); кэш
 * проверяется через обычный массив order, поэтому записи в byFile эффект не будят.
 */
export function ensureParsed(api: PluginApi, path: string): void {
  if (!path) return;
  const printerId = api.printer.id;
  const k = keyOf(printerId, path);
  if (order.includes(k)) {
    touch(k);
    return;
  }
  touch(k);
  byFile[k] = { status: 'loading' };

  const handle = api.moonrakerFor(printerId);
  const token = handle.authToken;
  const url = `${handle.httpBaseUrl}/server/files/${path.split('/').map(encodeURIComponent).join('/')}`;

  (async () => {
    try {
      const res = await fetch(url, token ? { headers: { Authorization: `Bearer ${token}` } } : undefined);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const parsed = await parseGcodeAsync(await res.text());
      // за время загрузки запись могла быть вытеснена или сброшена — не воскрешаем её
      if (order.includes(k)) byFile[k] = { status: 'ok', parsed };
    } catch (e) {
      if (order.includes(k)) byFile[k] = { status: 'error', message: e instanceof Error ? e.message : String(e) };
    }
  })();
}

/** Сбросить запись и загрузить файл заново (файл на принтере мог измениться). */
export function reloadParsed(api: PluginApi, path: string): void {
  if (!path) return;
  const k = keyOf(api.printer.id, path);
  const i = order.indexOf(k);
  if (i !== -1) order.splice(i, 1);
  delete byFile[k];
  ensureParsed(api, path);
}

export function getEntry(api: PluginApi, path: string): GcodeEntry | undefined {
  return path ? byFile[keyOf(api.printer.id, path)] : undefined;
}
