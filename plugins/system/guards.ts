import type { GuardContext, GuardDecision } from '../../plugin-sdk/src/types';

import { isPrinting } from './data/print-tracker.ts';
import { peekKlippyState, type KlippyState } from '../shared/klippy-state/use-klippy-state.svelte.ts';

interface GuardRequest {
  method: string;
  params: unknown;
}

/**
 * Машинные операции, которые обрывают печать или ломают её управление:
 * перезапуск Klipper/прошивки, перезагрузка и выключение хоста, обновления
 * (они перезапускают сервисы).
 */
const ALWAYS_BLOCKED_WHILE_PRINTING = new Set([
  'printer.restart',
  'printer.firmware_restart',
  'machine.reboot',
  'machine.shutdown',
  'machine.update.klipper',
  'machine.update.moonraker',
  'machine.update.system',
  'machine.update.client',
  'machine.update.full',
  'machine.update.recover',
  'machine.update.rollback',
]);

/** machine.services.* опасны только для сервиса Klipper (его перезапуск/остановка). */
const SERVICE_METHODS = new Set(['machine.services.restart', 'machine.services.stop']);
const KLIPPER_SERVICES = new Set(['klipper']);

/** Запрос трогает управляющий печатью сервис или хост? (чистая функция) */
export function endangersPrint(request: GuardRequest): boolean {
  if (ALWAYS_BLOCKED_WHILE_PRINTING.has(request.method)) return true;
  if (SERVICE_METHODS.has(request.method)) {
    const service = String((request.params as { service?: unknown } | undefined)?.service ?? '');
    return KLIPPER_SERVICES.has(service.trim().toLowerCase());
  }
  return false;
}

/**
 * Identify recovery restarts that can bypass a stale print_stats value after Klippy faults.
 * @param request Guarded Moonraker command and parameters.
 * @param state Live Klippy state for the target printer.
 * @returns Whether the command restarts Klippy in error or shutdown.
 */
export function isFaultRecoveryRestart(request: GuardRequest, state: KlippyState): boolean {
  if (state !== 'error' && state !== 'shutdown') return false;
  if (request.method === 'printer.restart' || request.method === 'printer.firmware_restart') return true;
  return request.method === 'machine.services.restart'
    && String((request.params as { service?: unknown } | undefined)?.service ?? '').trim().toLowerCase() === 'klipper';
}

/**
 * Guard `system-print-safety`: пока на принтере-адресате идёт печать (или пауза), другим
 * плагинам нельзя перезапускать Klipper/прошивку, перезагружать или выключать хост и
 * запускать обновления. Состояние печати — из трекера, при его отсутствии разовый запрос
 * к Moonraker; если узнать нельзя (оффлайн) — запрос проходит (команда всё равно не дойдёт).
 *
 * Запросы самого плагина System (правая панель) гард не видит (анти-рекурсия): для них
 * защитой служат диалоги подтверждения и блокировки в самом интерфейсе. Аварийная остановка
 * (printer.emergency_stop) НИКОГДА не блокируется.
 */
export const guardSystemPrintSafety = async (
  request: GuardRequest,
  _token: string,
  ctx: GuardContext,
): Promise<GuardDecision> => {
  if (!endangersPrint(request)) return { action: 'allow' };

  if (isFaultRecoveryRestart(request, peekKlippyState(ctx.targetPrinterId))) {
    return { action: 'allow' };
  }

  const printing = await isPrinting(ctx.targetPrinterId);
  return printing === true
    ? { action: 'deny', reasonKey: 'system.guard.print_in_progress' }
    : { action: 'allow' };
};
