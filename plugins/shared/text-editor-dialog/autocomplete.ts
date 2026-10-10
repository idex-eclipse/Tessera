/**
 * Автодополнение для редактора klipper-конфигов.
 *
 * Источники предложений (в порядке приоритета):
 *  1. Jinja-переменные ({% set %}, printer.*, params.*) — в контексте {{ }} / {% %};
 *  2. G-code команды — в gcode-блоке;
 *  3. Все слова из текста (klipper-ключи, имена секций, пути) — в любом контексте
 *     как запасной источник.
 *
 * Правила:
 *  - подсказки появляются ТОЛЬКО при непустом префиксе (минимум 1 символ);
 *  - специализированные источники имеют приоритет над «всеми словами»;
 *  - список ограничен limit (по умолчанию 12), чтобы dropdown не был бесконечным.
 */

export interface Suggestion {
  label: string;
  insert: string;
  kind: 'var' | 'cmd' | 'word';
}

export interface CompletionContext {
  inJinja: boolean;
  inGcode: boolean;
  inConfig: boolean;
  prefix: string;
  start: number;
  end: number;
}

/**
 * Определяет контекст ввода. Возвращает null, если:
 *  - префикс пустой (нет хотя бы одной буквы — подсказка не нужна);
 *  - находимся в месте, где автодополнение не имеет смысла (SAVE_CONFIG блок, комментарий).
 */
export function getCompletionContext(
  text: string,
  cursor: number,
): CompletionContext | null {
  // ---------- Jinja: {{ }}, {% %} или одиночная "{" ----------
  const left = text.slice(0, cursor);
  const openDbl = left.lastIndexOf('{{');
  const closeDbl = left.lastIndexOf('}}');
  const openPct = left.lastIndexOf('{%');
  const closePct = left.lastIndexOf('%}');

  let inJinja = openDbl > closeDbl || (openPct > closePct && openPct > closeDbl);

  // одиночная "{" (за ней не "{" и не "%", и она не закрыта "}")
  // тоже считается началом jinja-блока для подсказок
  if (!inJinja) {
    const lastBrace = left.lastIndexOf('{');
    const closeBrace = left.lastIndexOf('}');
    if (lastBrace > closeBrace) {
      const nextCh = left[lastBrace + 1];
      if (nextCh !== '{' && nextCh !== '%') inJinja = true;
    }
  }

  if (inJinja) {
    const prefix = readPrefix(text, cursor, /[\w.]/);
    // подсказки Jinja — только после ввода первой буквы префикса
    if (prefix === '') return null;
    const start = cursor - prefix.length;
    return {
      inJinja: true,
      inGcode: false,
      inConfig: false,
      prefix,
      start,
      end: cursor,
    };
  }

  // ---------- режим построчно (gcode / config / save) ----------
  const lines = left.split('\n');
  let mode: 'config' | 'gcode' | 'save' = 'config';
  for (let i = 0; i < lines.length - 1; i++) {
    const ln = lines[i] ?? '';
    if (mode === 'save') continue;
    if (/^#\*#.*SAVE_CONFIG/.test(ln)) { mode = 'save'; continue; }
    if (mode === 'config') {
      if (/^\s*gcode\s*[:=]\s*$/i.test(ln)) mode = 'gcode';
    } else {
      if (/^\S/.test(ln) && ln.trim() !== '') mode = 'config';
    }
  }

  if (mode === 'save') return null;
  const curLine = lines[lines.length - 1] ?? '';
  const lineStart = curLine.search(/\S/);
  if (lineStart >= 0 && curLine[lineStart] === '#') return null;

  // вне jinja — минимум один символ префикса
  const prefix = readPrefix(text, cursor, /[A-Za-z0-9_.]/);
  if (prefix === '') return null;

  return {
    inJinja: false,
    inGcode: mode === 'gcode',
    inConfig: mode === 'config',
    prefix,
    start: cursor - prefix.length,
    end: cursor,
  };
}

/**
 * Считывает максимально длинный префикс word-символов, заканчивающийся на `cursor`.
 * Возвращает '' если перед курсором не word-символ.
 */
function readPrefix(text: string, cursor: number, re: RegExp): string {
  let s = cursor;
  while (s > 0 && re.test(text[s - 1] ?? '')) s--;
  return text.slice(s, cursor);
}

/** Jinja-переменные из {% set %} и printer.* / params.* */
export function collectJinjaVars(text: string): string[] {
  // базовые объекты jinja предлагаются всегда, даже если в файле не встречались
  const vars = new Set<string>(['printer.', 'params.']);

  for (const m of text.matchAll(/\{%-?\s*set\s+([A-Za-z_][\w.]*)\s*=/g)) {
    vars.add(m[1] ?? '');
  }
  for (const m of text.matchAll(/\b((?:printer|params)\.[\w.[\]']+)/g)) {
    vars.add(m[1] ?? '');
  }
  return [...vars].sort();
}

/**
 * Все уникальные слова из текста (klipper-ключи, имена секций, пути, макросы).
 * Короткие (1 символ) и «мусор» (чистые числа) отбрасываем.
 */
export function collectAllWords(text: string, minLen = 2): string[] {
  const set = new Set<string>();
  const re = /[A-Za-z_][A-Za-z0-9_.]*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const w = m[0] ?? '';
    if (w.length >= minLen) set.add(w);
  }
  return [...set].sort();
}

/**
 * Генерирует список предложений.
 *
 * Приоритет:
 *  1. Специализированные источники (Jinja vars / GCode команды).
 *  2. Общие слова из текста (klipper-ключи и т.п.) — как запасной источник,
 *     с исключением уже предложенных.
 */
export interface CompletionSources {
  jinjaVars: string[];
  allWords: string[];
  gcodeCommands: string[]; // из printer.gcode.help
}

export function getSuggestions(
  ctx: CompletionContext,
  sources: CompletionSources,
  limit = 12,
): Suggestion[] {
  const q = ctx.prefix.toLowerCase();
  const out: Suggestion[] = [];
  const seen = new Set<string>();

  const push = (s: Suggestion) => {
    if (seen.has(s.label) || s.label.toLowerCase() === q) return;
    seen.add(s.label);
    out.push(s);
  };

  if (ctx.inJinja) {
    for (const v of sources.jinjaVars) {
      if (out.length >= limit) break;
      if (v.toLowerCase().startsWith(q)) push({ label: v, insert: v, kind: 'var' });
    }
  } else if (ctx.inGcode) {
    // команды из Moonraker — приоритет, затем общие слова файла
    for (const c of sources.gcodeCommands) {
      if (out.length >= limit) break;
      if (c.toLowerCase().startsWith(q)) push({ label: c, insert: c, kind: 'cmd' });
    }
    for (const w of sources.allWords) {
      if (out.length >= limit) break;
      if (w.toLowerCase().startsWith(q)) push({ label: w, insert: w, kind: 'word' });
    }
  } else {
    for (const w of sources.allWords) {
      if (out.length >= limit) break;
      if (w.toLowerCase().startsWith(q)) push({ label: w, insert: w, kind: 'word' });
    }
  }

  return out.slice(0, limit);
}