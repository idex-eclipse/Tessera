/**
 * Подбор подсказок по строке G-code: общий для консоли и редактора.
 *
 * Принимает текст строки от начала команды до каретки и каталог команд; возвращает
 * подсказки и позицию, с которой их нужно подставлять (до каретки).
 */
import { namedParams } from './catalog';
import { quoteValue, type NameResolver } from './object-names';
import type { Catalog, CommandInfo, ParamInfo } from './types';

export interface HintSuggestion {
  kind: 'command' | 'param' | 'value';
  /** что показано в списке */
  label: string;
  /** что подставить вместо [replaceStart, каретка) */
  insert: string;
  description?: string;
  command?: CommandInfo;
  param?: ParamInfo;
}

export interface SuggestOptions {
  limit?: number;
  /** после совпадений по префиксу добавить совпадения по подстроке (консоль) */
  substring?: boolean;
  /** не предлагать команду, которая уже набрана целиком и ничего не добавит */
  skipExact?: boolean;
  /** имена объектов принтера для значений `FAN=`, `HEATER=`… (см. makeNameResolver) */
  names?: NameResolver;
}

export interface HintResult {
  items: HintSuggestion[];
  /** смещение в переданной строке, с которого заменяется токен под кареткой */
  replaceStart: number;
  /** токен под кареткой пуст — список показан сразу после пробела или `=` */
  passive: boolean;
}

const EMPTY: HintResult = { items: [], replaceStart: 0, passive: false };

interface TokenScan {
  /** начало токена под кареткой (в строке без начальных пробелов) */
  start: number;
  /** каретка внутри строки в кавычках — подсказки не нужны */
  openQuote: boolean;
}

function scanLastToken(s: string): TokenScan {
  let start = 0;
  let quote = false;
  let inToken = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i] ?? '';
    if (c === '"') {
      quote = !quote;
      if (!inToken) {
        start = i;
        inToken = true;
      }
    } else if (/\s/.test(c) && !quote) {
      inToken = false;
      start = i + 1;
    } else if (!inToken) {
      start = i;
      inToken = true;
    }
  }
  return { start, openQuote: quote };
}

/**
 * Позиция (в `linePrefix`), с которой начинается токен под кареткой, или null, если
 * подсказки неуместны (внутри строки в кавычках). Для `NAME=val` — позиция после `=`.
 */
export function completionTokenStart(linePrefix: string): number | null {
  const lead = linePrefix.length - linePrefix.trimStart().length;
  const s = linePrefix.slice(lead);
  if (s === '') return lead;
  const { start, openQuote } = scanLastToken(s);
  if (openQuote) return null;
  const token = s.slice(start);
  const eq = token.indexOf('=');
  if (eq === -1) return lead + start;
  // в списке значений (`CHIPS=a,b`) подбор идёт по последнему элементу
  const comma = token.lastIndexOf(',');
  return lead + start + (comma > eq ? comma + 1 : eq + 1);
}

/** Введённые на строке `ИМЯ=значение` (ключи в верхнем регистре, кавычки сняты). */
function enteredValues(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of text.matchAll(/([A-Za-z_]\w*)=("(?:[^"\\]|\\.)*"|\S*)/g)) {
    const raw = m[2] ?? '';
    out[(m[1] ?? '').toUpperCase()] = raw.startsWith('"') ? raw.slice(1, -1) : raw;
  }
  return out;
}

function sortByName(a: CommandInfo, b: CommandInfo): number {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

function commandItem(info: CommandInfo): HintSuggestion {
  return {
    kind: 'command',
    label: info.name,
    // пробел сразу после команды, у которой есть параметры (буквенные или NAME=)
    insert: info.params.length > 0 ? `${info.name} ` : info.name,
    description: info.description,
    command: info,
  };
}

export function suggestForLine(
  catalog: Catalog,
  linePrefix: string,
  opts: SuggestOptions = {},
): HintResult {
  const lead = linePrefix.length - linePrefix.trimStart().length;
  const s = linePrefix.slice(lead);
  if (s === '') return EMPTY;
  const limit = opts.limit ?? Infinity;

  const ws = s.search(/\s/);

  // ---------- имя команды ----------
  if (ws === -1) {
    const token = s.toUpperCase();
    const all = [...catalog.values()];
    const prefix = all.filter((i) => i.name.toUpperCase().startsWith(token)).sort(sortByName);
    const sub = opts.substring
      ? all
          .filter((i) => !i.name.toUpperCase().startsWith(token) && i.name.toUpperCase().includes(token))
          .sort(sortByName)
      : [];

    let items = [...prefix, ...sub].map(commandItem);
    if (opts.skipExact) {
      // набрано целиком, и подставлять нечего — не мешаем
      items = items.filter((it) => !(it.label.toUpperCase() === token && it.insert === it.label));
    }
    return { items: items.slice(0, limit), replaceStart: lead, passive: false };
  }

  // ---------- параметры и значения ----------
  const info = catalog.get(s.slice(0, ws).toUpperCase());
  if (!info) return EMPTY;

  const rest = s.slice(ws + 1);
  const { start, openQuote } = scanLastToken(rest);
  if (openQuote) return EMPTY;
  const current = rest.slice(start);
  const tokenAbs = lead + ws + 1 + start;

  const params = namedParams(info);
  if (params.length === 0) return EMPTY;

  const eq = current.indexOf('=');
  if (eq !== -1) {
    const param = params.find((p) => p.name.toUpperCase() === current.slice(0, eq).toUpperCase());
    const valuePrefix = current.slice(eq + 1);
    if (!param) return EMPTY;

    // значение из перечисления (`MODE=PRIMARY|COPY|…`, `ENABLE=0|1`)
    if (param.choices) {
      const q = valuePrefix.toUpperCase();
      const items: HintSuggestion[] = param.choices
        .filter((c) => c.toUpperCase().startsWith(q) && c.toUpperCase() !== q)
        .map((c) => ({ kind: 'value' as const, label: c, insert: c, param, command: info }));
      return {
        items: items.slice(0, limit),
        replaceStart: tokenAbs + eq + 1,
        passive: valuePrefix === '',
      };
    }

    // имя объекта принтера (`FAN=`, `HEATER=`, …)
    const resolved = opts.names?.(info.name, param.name, enteredValues(rest.slice(0, start)));
    if (!resolved) return EMPTY;

    let segment = valuePrefix;
    let segmentStart = 0;
    let chosen = new Set<string>();
    if (resolved.separator) {
      const i = valuePrefix.lastIndexOf(resolved.separator);
      segment = valuePrefix.slice(i + 1);
      segmentStart = i + 1;
      chosen = new Set(
        i === -1 ? [] : valuePrefix.slice(0, i).split(resolved.separator).map((v) => v.toLowerCase()),
      );
    }
    const q = segment.toUpperCase();
    const items: HintSuggestion[] = resolved.names
      .filter(
        (n) =>
          n.value.toUpperCase().startsWith(q) &&
          n.value.toUpperCase() !== q &&
          !chosen.has(n.value.toLowerCase()),
      )
      .map((n) => ({
        kind: 'value' as const,
        label: n.value,
        insert: resolved.separator ? n.value : quoteValue(n.value),
        description: n.detail,
        param,
        command: info,
      }));
    return {
      items: items.slice(0, limit),
      replaceStart: tokenAbs + eq + 1 + segmentStart,
      passive: segment === '',
    };
  }

  // имя параметра: ещё не использованные, обязательные первыми
  const used = new Set(
    rest
      .slice(0, start)
      .split(/\s+/)
      .filter((t) => t.includes('='))
      .map((t) => (t.split('=')[0] ?? '').toUpperCase()),
  );
  const q = current.toUpperCase();
  const candidates = params.filter(
    (p) => !used.has(p.name.toUpperCase()) && p.name.toUpperCase().startsWith(q),
  );
  const ordered = [...candidates.filter((p) => p.required), ...candidates.filter((p) => !p.required)];
  const items: HintSuggestion[] = ordered.map((p) => ({
    kind: 'param' as const,
    label: `${p.name}=`,
    insert: `${p.name}=`,
    description: p.description,
    command: info,
    param: p,
  }));
  return { items: items.slice(0, limit), replaceStart: tokenAbs, passive: current === '' };
}
