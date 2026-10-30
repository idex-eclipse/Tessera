import type { FleetIndexEntry, FleetTag } from '../../plugin-sdk/src/types';
import type { KlippyState } from '../shared/klippy-state/use-klippy-state.svelte.ts';
import { isKlippyFault } from '../shared/klippy-state/klippy-fault.ts';

/**
 * Fleet-индекс принтера для поиска и фильтров fleet-режима.
 *
 * Хост не знает смысла тегов — смысл задаёт этот модуль:
 * - klippy-error: Klipper в `error`/`shutdown` (других тегов тогда нет);
 * - printing:     Klipper ready, задание активно (printing или paused);
 * - idle:         Klipper ready, задания нет (standby/complete/cancelled/error).
 * Klipper в startup/disconnected/unknown — без тегов: принтер виден только
 * когда фильтры не выбраны.
 *
 * searchText — имя файла активного задания (не последнего завершённого).
 */

export const FLEET_TAGS = {
  printing: { id: 'printing', labelKey: 'fleet.filter.printing', icon: 'print', order: 0 },
  idle: { id: 'idle', labelKey: 'fleet.filter.idle', icon: 'power', order: 1 },
  klippyError: {
    id: 'klippy-error',
    labelKey: 'fleet.filter.klippyError',
    icon: 'warning',
    order: 2,
  },
} as const satisfies Record<string, FleetTag>;

export function buildFleetIndex(
  klippy: KlippyState,
  print: { state: string; filename: string },
): FleetIndexEntry {
  if (isKlippyFault(klippy)) {
    return { tags: [FLEET_TAGS.klippyError], searchText: '' };
  }
  if (klippy !== 'ready') {
    return { tags: [], searchText: '' };
  }

  const active = print.state === 'printing' || print.state === 'paused';
  return active
    ? { tags: [FLEET_TAGS.printing], searchText: print.filename }
    : { tags: [FLEET_TAGS.idle], searchText: '' };
}
