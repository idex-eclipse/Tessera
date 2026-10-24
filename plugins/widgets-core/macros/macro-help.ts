/**
 * Описания макросов для подсказок: printer.gcode.help возвращает { ИМЯ_КОМАНДЫ: описание },
 * имена команд в Klipper — в верхнем регистре, а в objects.list макросы названы как в
 * конфиге. Сопоставляем без учёта регистра; ключ результата — имя макроса как в конфиге.
 */
export function mapMacroHelp(names: string[], helpRes: unknown): Record<string, string> {
  const byUpper = new Map<string, string>();
  if (helpRes && typeof helpRes === 'object') {
    for (const [k, v] of Object.entries(helpRes as Record<string, unknown>)) {
      if (typeof v === 'string' && v) byUpper.set(k.toUpperCase(), v);
    }
  }
  const out: Record<string, string> = {};
  for (const n of names) {
    const d = byUpper.get(n.toUpperCase());
    if (d) out[n] = d;
  }
  return out;
}
