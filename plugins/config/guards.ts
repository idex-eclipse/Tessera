import type { GuardDecision } from '../../plugin-sdk/src/types';

interface GuardRequest {
  method: string;
  params: unknown;
}

/**
 * Файлы, потеря или подмена которых оставляет принтер без конфигурации:
 * без printer.cfg Klipper не запустится, без moonraker.conf — Moonraker.
 */
const CRITICAL_FILES = new Set(['config/printer.cfg', 'config/moonraker.conf']);
const CONFIG_ROOT = 'config';

/**
 * Путь Moonraker ("config/printer.cfg") в сравнимый вид: нижний регистр, без
 * ведущих/двойных слэшей, с разрешёнными сегментами "." и "..".
 * ("config/./sub/../printer.cfg" и "/config//printer.cfg" — тот же файл.)
 */
export function normalizeMoonrakerPath(raw: unknown): string {
  const out: string[] = [];
  for (const seg of String(raw ?? '').trim().replace(/\\/g, '/').split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') out.pop();
    else out.push(seg.toLowerCase());
  }
  return out.join('/');
}

export function isCriticalConfigPath(raw: unknown): boolean {
  return CRITICAL_FILES.has(normalizeMoonrakerPath(raw));
}

const DENY: GuardDecision = { action: 'deny', reasonKey: 'config.guard.critical_file' };
const ALLOW: GuardDecision = { action: 'allow' };

/**
 * Guard `config-critical-files`: запрещает ДРУГИМ плагинам удалять, переименовывать
 * и затирать printer.cfg / moonraker.conf (и удалять корень config целиком).
 *
 * Важно: гард не охраняет запросы самого плагина-владельца (анти-рекурсия
 * GuardAgent), поэтому собственные операции страницы конфигов защищены
 * подтверждением в диалогах, а не этим гардом. Гард без состояния — решение
 * принимается только по методу и параметрам запроса.
 */
export const guardCriticalConfig = (request: GuardRequest): GuardDecision => {
  const p = (request.params ?? {}) as Record<string, unknown>;

  switch (request.method) {
    case 'server.files.delete_file':
      return isCriticalConfigPath(p.path) ? DENY : ALLOW;

    case 'server.files.delete_directory':
      return normalizeMoonrakerPath(p.path) === CONFIG_ROOT ? DENY : ALLOW;

    case 'server.files.move':
      return isCriticalConfigPath(p.source) ||
        isCriticalConfigPath(p.dest) ||
        normalizeMoonrakerPath(p.source) === CONFIG_ROOT
        ? DENY
        : ALLOW;

    case 'server.files.copy':
      return isCriticalConfigPath(p.dest) ? DENY : ALLOW;

    default:
      return ALLOW;
  }
};
