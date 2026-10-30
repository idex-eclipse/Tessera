/**
 * Автодополнение для редактора klipper-конфигов.
 *
 * Источники предложений (в порядке приоритета):
 *  1. Jinja-переменные ({% set %}, printer.*, params.*) — в контексте {{ }} / {% %};
 *     `params.` внутри макроса — параметры именно этого макроса;
 *  2. G-code в gcode-блоке: команды, параметры (`NAME=`) и перечисления значений из
 *     общего каталога shared/gcode-hints (printer.gcode.help + G-Codes.md + макросы);
 *  3. Все слова из текста (klipper-ключи, имена секций, пути) — в любом контексте
 *     как запасной источник.
 *
 * Правила:
 *  - подсказки появляются при непустом префиксе; единственное исключение — gcode-строка
 *    после пробела или «=» (список параметров / значений команды), см. CompletionContext;
 *  - специализированные источники имеют приоритет над «всеми словами»;
 *  - список ограничен limit (по умолчанию 12), чтобы dropdown не был бесконечным.
 */

import { paramTypeLabel } from '../gcode-hints/catalog';
import { completionTokenStart, suggestForLine, type HintSuggestion } from '../gcode-hints/suggest';
import type { Catalog } from '../gcode-hints/types';

export interface Suggestion {
  label: string;
  insert: string;
  kind: 'var' | 'cmd' | 'macro' | 'param' | 'value' | 'word';
  /** пояснение справа: описание команды, тип параметра */
  detail?: string;
}

export interface CompletionContext {
  inJinja: boolean;
  inGcode: boolean;
  inConfig: boolean;
  /** токен под кареткой; пуст только в gcode-строке после пробела или «=» */
  prefix: string;
  start: number;
  end: number;
  /** gcode-строка от начала до каретки (для подбора команд / параметров / значений) */
  linePrefix?: string;
}

/** Список показан без набранных букв (сразу после пробела или «=»). */
export function isPassive(ctx: CompletionContext): boolean {
  return ctx.prefix === '';
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

  // gcode-строка: команда, затем параметры `NAME=` и их значения
  if (mode === 'gcode') {
    if (curLine.includes(';')) return null; // комментарий gcode
    const tokenStart = completionTokenStart(curLine);
    if (tokenStart === null) return null; // каретка внутри строки в кавычках
    const start = cursor - (curLine.length - tokenStart);
    const gprefix = text.slice(start, cursor);
    // пустой токен допустим только после имени команды (параметры / значения)
    if (gprefix === '' && !/\s/.test(curLine.trimStart())) return null;
    return {
      inJinja: false,
      inGcode: true,
      inConfig: false,
      prefix: gprefix,
      start,
      end: cursor,
      linePrefix: curLine,
    };
  }

  // вне jinja — минимум один символ префикса
  const prefix = readPrefix(text, cursor, /[A-Za-z0-9_.]/);
  if (prefix === '') return null;

  // сюда доходит только config-режим: gcode разобран выше, save отсёкся раньше
  return {
    inJinja: false,
    inGcode: false,
    inConfig: true,
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
  /** каталог команд (help + G-Codes.md + макросы принтера и файла) */
  catalog?: Catalog;
  /** параметры макроса, в теле которого каретка; null — каретка вне макроса */
  macroParams?: string[] | null;
}

function detailOf(h: HintSuggestion): string | undefined {
  if (h.kind === 'param' && h.param) {
    const p = h.param;
    const parts = [paramTypeLabel(p), p.def != null ? `= ${p.def}` : '', p.required ? '*' : ''];
    return parts.filter(Boolean).join(' ') || h.description;
  }
  return h.description;
}

function fromHint(h: HintSuggestion): Suggestion {
  const kind: Suggestion['kind'] =
    h.kind === 'command' ? (h.command?.kind === 'macro' ? 'macro' : 'cmd') : h.kind;
  return { label: h.label, insert: h.insert, kind, detail: detailOf(h) };
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
    // набранное целиком и без дополнений (нет пробела / «=» для подстановки) не предлагаем
    if (seen.has(s.label) || (s.label.toLowerCase() === q && s.insert === s.label)) return;
    seen.add(s.label);
    out.push(s);
  };

  if (ctx.inJinja) {
    // внутри макроса `params.` предлагает параметры этого макроса, а не всего файла
    const scoped =
      sources.macroParams && q.startsWith('params.')
        ? sources.macroParams.map((n) => `params.${n}`)
        : null;
    for (const v of scoped ?? sources.jinjaVars) {
      if (out.length >= limit) break;
      if (v.toLowerCase().startsWith(q)) push({ label: v, insert: v, kind: 'var' });
    }
  } else if (ctx.inGcode) {
    // команды, параметры и значения из каталога — приоритет, затем общие слова файла
    if (sources.catalog && ctx.linePrefix !== undefined) {
      const r = suggestForLine(sources.catalog, ctx.linePrefix, { limit, skipExact: true });
      for (const h of r.items) push(fromHint(h));
    }
    // слова файла: на месте команды (там живут и макросы, которых каталог ещё не знает)
    // и как запасной вариант, когда каталог ничего не предложил
    const commandPos = ctx.linePrefix === undefined || !/\s/.test(ctx.linePrefix.trimStart());
    if (q !== '' && (commandPos || out.length === 0)) {
      for (const w of sources.allWords) {
        if (out.length >= limit) break;
        if (w.toLowerCase().startsWith(q)) push({ label: w, insert: w, kind: 'word' });
      }
    }
  } else {
    for (const w of sources.allWords) {
      if (out.length >= limit) break;
      if (w.toLowerCase().startsWith(q)) push({ label: w, insert: w, kind: 'word' });
    }
  }

  return out.slice(0, limit);
}