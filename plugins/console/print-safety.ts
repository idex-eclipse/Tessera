/**
 * Защита ввода консоли от перезапуска Klipper во время печати.
 *
 * Собственные запросы плагина GuardAgent не проверяет (анти-рекурсия), поэтому
 * страховка — в самом интерфейсе: перезапуск при идущей печати требует повторного
 * Enter. Аварийная остановка (M112) НИКОГДА не задерживается.
 */

/** Команды, обрывающие печать (перезапуск Klipper / прошивки). */
const PRINT_BREAKING = new Set(['RESTART', 'FIRMWARE_RESTART']);

/** Первые слова непустых не-комментарных строк скрипта, в верхнем регистре. */
export function scriptCommands(script: string): string[] {
  const out: string[] = [];
  for (const raw of script.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith(';') || line.startsWith('#')) continue;
    out.push(line.split(/\s+/)[0]!.toUpperCase());
  }
  return out;
}

/** Обрывает ли скрипт печать (содержит RESTART / FIRMWARE_RESTART)? */
export function breaksPrint(script: string): boolean {
  return scriptCommands(script).some((c) => PRINT_BREAKING.has(c));
}

/** Идёт ли печать (в том числе на паузе) по `print_stats.state`. */
export function isPrintActive(state: string | undefined): boolean {
  return state === 'printing' || state === 'paused';
}
