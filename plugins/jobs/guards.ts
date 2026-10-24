import type { GuardDecision } from '../../plugin-sdk/src/types';

interface GuardRequest {
  method: string;
  params: unknown;
}

function is3mf(name: unknown): boolean {
  return typeof name === 'string' && /\.3mf$/i.test(name.trim());
}

/**
 * Guard `jobs-no-3mf-print`: .3mf — проектный контейнер, а не G-code (решение U).
 * Старт печати или постановка в очередь такого файла приведёт только к ошибке
 * Klipper, поэтому запрос отклоняется до отправки — с понятной причиной.
 *
 * Охраняет запросы ДРУГИХ плагинов (очередь, история, «повторить печать»): запросы
 * самого Jobs гард не видит (анти-рекурсия), там то же правило соблюдает меню и
 * `jobsCustomAction`. Гард без состояния — решение по методу и параметрам.
 */
export const guardNo3mfPrint = (request: GuardRequest): GuardDecision => {
  const p = (request.params ?? {}) as { filename?: unknown; filenames?: unknown };

  let names: unknown[] = [];
  if (request.method === 'printer.print.start') names = [p.filename];
  else if (request.method === 'server.job_queue.post_job') {
    names = Array.isArray(p.filenames) ? p.filenames : [];
  }

  return names.some(is3mf)
    ? { action: 'deny', reasonKey: 'jobs.guard.three_mf_not_printable' }
    : { action: 'allow' };
};
