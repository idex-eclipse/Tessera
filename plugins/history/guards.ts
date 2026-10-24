import type { GuardDecision } from '../../plugin-sdk/src/types';

interface GuardRequest {
  method: string;
  params: unknown;
}

/**
 * Методы Moonraker, необратимо стирающие историю печати или накопленную статистику.
 */
const DESTRUCTIVE_HISTORY_METHODS = new Set([
  'server.history.delete_job',
  'server.history.delete_all',
  'server.history.reset_totals',
]);

/**
 * Guard `history-owner-only`: историей и статистикой принтера распоряжается только
 * плагин History (там — диалог подтверждения). Другим плагинам стереть историю или
 * сбросить итоги нельзя: действие необратимо и пользователь не ожидает его
 * от несвязанного виджета или макроса.
 *
 * Запросы самого History гард не видит (анти-рекурсия GuardAgent), их защищает
 * подтверждение в интерфейсе. Гард без состояния — решение по методу.
 */
export const guardHistoryOwnerOnly = (request: GuardRequest): GuardDecision =>
  DESTRUCTIVE_HISTORY_METHODS.has(request.method)
    ? { action: 'deny', reasonKey: 'history.guard.owner_only' }
    : { action: 'allow' };
