/**
 * Загрузка Klipper Config_Reference.md через Moonraker (файловый root `docs`).
 * Чтение, кеш по принтеру и классификация ошибок — в shared/gcode-hints/doc-source.
 */
import type { PluginApi } from '../../../plugin-sdk/src/types';
import {
  classifyDocError,
  clearDocCache,
  loadDoc,
} from '../gcode-hints/doc-source';
import { parseReference, type ReferenceIndex } from './config-reference';

export const REFERENCE_PATH = 'Config_Reference.md';

export function clearReferenceCache(): void {
  clearDocCache();
}

export function loadReference(api: PluginApi): Promise<ReferenceIndex> {
  return loadDoc({
    key: `${api.printer?.id ?? ''}|${REFERENCE_PATH}`,
    handle: () => api.moonraker(),
    path: REFERENCE_PATH,
    parse: parseReference,
  });
}

export type ReferenceErrorKind = 'unavailable' | 'error';

/** 401/403/404 — root `docs` не отдаётся или файла нет; остальное — обычная ошибка. */
export function classifyReferenceError(e: unknown): { kind: ReferenceErrorKind; message: string } {
  return classifyDocError(e);
}
