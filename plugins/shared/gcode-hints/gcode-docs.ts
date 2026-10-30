/**
 * Разбор Klipper docs/G-Codes.md в справочник команд.
 *
 * Структура документа:
 *  - `## G-Code commands` — список стандартных G/M-команд:
 *      - Move (G0 or G1): `G1 [X<pos>] [Y<pos>] [Z<pos>] [E<pos>] [F<speed>]`
 *  - `## Additional Commands` → `### [модуль]` → `#### КОМАНДА`; блок начинается с usage
 *    в обратных кавычках (может переноситься на несколько строк):
 *      `NAME [P=<v>] Q=<v>`: описание…
 *
 * Парсер намеренно снисходителен: в документе встречаются опечатки в скобках и
 * несбалансированные `[`, а у части команд несколько usage (параметры объединяются).
 */

import type { CommandDoc, GcodeDocs, ParamInfo, ValueKind } from './types';

// ----------------------------------------------------------------------
// usage → параметры
// ----------------------------------------------------------------------

const NUMBER_HINT =
  /^(value|pos|position|count|degrees|angle|adjust|offset|index|number|rate|factor|percent|samples|retries|tolerance|steps|current|layer|hz|ms|mm|mm\/s|[a-z_]*(speed|accel|dist|distance|time|temp|temperature|seconds|duration|height|width|length|velocity|delay|size)[a-z_]*)$/;

function kindOfHint(hint: string): ValueKind {
  const h = hint.toLowerCase();
  if (h === 'name' || h.endsWith('_name') || h.startsWith('name_')) return 'name';
  if (NUMBER_HINT.test(h)) return 'number';
  return 'text';
}

function cleanChoice(s: string): string {
  return s.replace(/^[\s[<"']+|[\s\]>"']+$/g, '');
}

/** Параметр + буквальное значение из usage (нужно только для слияния нескольких usage). */
type RawParam = ParamInfo & { literal?: string };

interface ParsedValue {
  kind: ValueKind;
  hint?: string;
  choices?: string[];
  literal?: string;
}

function parseValue(raw: string): ParsedValue {
  const v = raw.trim();
  if (!v) return { kind: 'text' };

  const unquoted = v.replace(/^"(.*?)"?$/, '$1');

  // [0:1] / <0:1>
  const colon = /^[[<]*(\d+):(\d+)[\]>]*$/.exec(unquoted);
  if (colon) return { kind: 'flag', choices: [colon[1] ?? '0', colon[2] ?? '1'] };

  // перечисления: [0|1], <X|Y>, a|b|c, [PRIMARY|COPY|MIRROR|INACTIVE]
  if (unquoted.includes('|')) {
    const choices = unquoted
      .split('|')
      .map(cleanChoice)
      .filter((c) => c !== '' && !/[<>=]/.test(c));
    if (choices.length > 1) {
      const flag = choices.length === 2 && choices.includes('0') && choices.includes('1');
      return { kind: flag ? 'flag' : 'enum', choices };
    }
  }

  // <placeholder> (в документе бывает без закрывающей `>`)
  const ph = /^<([^<>]*)>?$/.exec(unquoted);
  if (ph) {
    const hint = (ph[1] ?? '').trim();
    return { kind: kindOfHint(hint), hint };
  }

  // [A-Z], X,Y, [[x,y],...] и т.п.
  if (/[[\],<>]/.test(unquoted)) return { kind: 'text', hint: unquoted };

  // config_name / object_name — подсказка-имя, остальные слова — буквальное значение
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(unquoted) && /(^|_)name$/.test(unquoted)) {
    return { kind: 'name', hint: unquoted };
  }
  if (/^[A-Za-z0-9_.+-]+$/.test(unquoted)) return { kind: 'text', literal: unquoted };

  return { kind: 'text', hint: unquoted };
}

/**
 * Читает значение после `=`: до пробела, закрывающей `]` необязательной группы или
 * `|NAME=` (альтернативный параметр). Скобки считаем стеком: в документе есть
 * `[ZFADE=<value]` (незакрытая `<`) — её закрывает `]` группы.
 */
function readValue(s: string, from: number): { value: string; end: number } {
  const stack: string[] = [];
  let i = from;
  for (; i < s.length; i++) {
    const c = s[i] ?? '';
    if (c === '"') {
      const close = s.indexOf('"', i + 1);
      i = close === -1 ? s.length - 1 : close;
      continue;
    }
    if (c === '[' || c === '<') {
      stack.push(c);
      continue;
    }
    if (c === '>') {
      if (stack[stack.length - 1] === '<') stack.pop();
      continue;
    }
    if (c === ']') {
      while (stack[stack.length - 1] === '<') stack.pop();
      if (stack.length === 0) break; // закрывает группу, в которой стоит параметр
      stack.pop();
      continue;
    }
    if (/\s/.test(c) && stack.length === 0) break;
    if (c === '|' && stack.length === 0 && /^\|\s*[A-Z_][A-Z0-9_]*=/.test(s.slice(i))) break;
  }
  return { value: s.slice(from, i), end: i };
}

function stripRaw(p: RawParam): ParamInfo {
  const { literal: _literal, ...rest } = p;
  return rest;
}

function parseUsageRaw(usage: string): { name: string; params: RawParam[] } {
  const text = usage.replace(/\s+/g, ' ').trim();
  const sp = text.indexOf(' ');
  const name = (sp === -1 ? text : text.slice(0, sp)).replace(/[:,]$/, '');
  const rest = sp === -1 ? '' : text.slice(sp + 1);
  const params: RawParam[] = [];

  if (/\b[A-Z_][A-Z0-9_]*=/.test(rest)) {
    const re = /([A-Za-z_][A-Za-z0-9_]*)=/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(rest))) {
      const at = m.index;
      // `<param_x>=<literal>` и т.п. — подстановочные имена, настоящего параметра нет
      if (rest[at - 1] === '<') continue;
      const pname = m[1] ?? '';
      if (!/^[A-Z_][A-Z0-9_]*$/.test(pname)) continue;

      let k = at - 1;
      while (k >= 0 && rest[k] === ' ') k--;
      const optional = k >= 0 && (rest[k] === '[' || rest[k] === '|');

      const { value, end } = readValue(rest, at + m[0].length);
      re.lastIndex = Math.max(re.lastIndex, end);

      const pv = parseValue(value);
      params.push({
        name: pname,
        style: 'named',
        optional,
        required: !optional,
        valueKind: pv.kind,
        hint: pv.hint ?? pv.literal,
        choices: pv.choices,
        literal: pv.literal,
      });
    }
  } else if (rest) {
    // G/M-команды: буквенные параметры `[X<pos>] [Y<pos>]`, `S<value>`, `[X]`
    for (const tok of rest.split(' ')) {
      const m = /^\[*([A-Za-z])(?:<([^>]*)>?)?\]*$/.exec(tok);
      if (!m) continue;
      const optional = tok.startsWith('[');
      const hint = (m[2] ?? '').trim() || undefined;
      params.push({
        name: (m[1] ?? '').toUpperCase(),
        style: 'letter',
        optional,
        required: !optional,
        valueKind: hint ? kindOfHint(hint) : 'flag',
        hint,
      });
    }
  }
  return { name, params };
}

export interface ParsedUsage {
  name: string;
  params: ParamInfo[];
}

/** Разбор одной строки usage: `NAME [P=<v>] Q=<v>` или `G1 [X<pos>] [F<speed>]`. */
export function parseUsage(usage: string): ParsedUsage {
  const { name, params } = parseUsageRaw(usage);
  return { name, params: params.map(stripRaw) };
}

/** Объединяет параметры нескольких usage одной команды. */
function mergeParams(lists: RawParam[][]): ParamInfo[] {
  const byName = new Map<string, { p: RawParam; literals: Set<string>; seen: number }>();
  for (const list of lists) {
    const inThisUsage = new Set<string>();
    for (const p of list) {
      const key = p.name.toUpperCase();
      if (inThisUsage.has(key)) continue;
      inThisUsage.add(key);
      const cur = byName.get(key);
      if (!cur) {
        byName.set(key, { p: { ...p }, literals: new Set(p.literal ? [p.literal] : []), seen: 1 });
        continue;
      }
      cur.seen++;
      // обязателен, только если обязателен в каждом usage (см. ниже); здесь копим «необязательность»
      cur.p.optional = cur.p.optional || p.optional;
      if (!cur.p.choices && p.choices) {
        cur.p.choices = p.choices;
        cur.p.valueKind = p.valueKind;
      }
      if (!cur.p.hint && p.hint) cur.p.hint = p.hint;
      if (p.literal) cur.literals.add(p.literal);
    }
  }
  const out: ParamInfo[] = [];
  for (const { p, literals, seen } of byName.values()) {
    // параметр, которого нет в части usage (SPEED/TEMPLATE у SET_FAN_SPEED — взаимозаменяемы),
    // обязательным не считаем
    if (seen < lists.length) p.optional = true;
    p.required = !p.optional;
    // несколько usage с разными литералами (`TYPE=echo`, `TYPE=error`) = перечисление
    if (!p.choices && literals.size > 1) {
      p.choices = [...literals];
      p.valueKind = 'enum';
    }
    out.push(stripRaw(p));
  }
  return out;
}

// ----------------------------------------------------------------------
// описания
// ----------------------------------------------------------------------

function firstSentence(text: string, max = 180): string {
  const t = text.replace(/\s+/g, ' ').trim();
  let end = -1;
  const re = /[.!?](?=\s|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t))) {
    if (m.index < 12) continue;
    // «e.g.», «i.e.», «eg.» — не конец предложения
    if (/(?:\be\.g|\bi\.e|\beg|\bie|\betc)\.$/i.test(t.slice(0, m.index + 1))) continue;
    end = m.index + 1;
    break;
  }
  const s = end === -1 ? t : t.slice(0, end);
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

function cleanMd(s: string): string {
  return s
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

const USAGE_RE = /(?:^|\n)[ \t]*(?:[-*] )?`([^`\n][^`]*)`/g;

function sameCommand(first: string, name: string): boolean {
  return first.replace(/[:,]$/, '').toUpperCase() === name.toUpperCase();
}

// ----------------------------------------------------------------------
// документ целиком
// ----------------------------------------------------------------------

interface Heading {
  line: number;
  level: number;
  text: string;
}

function headingsOf(lines: string[]): Heading[] {
  const out: Heading[] = [];
  let fenced = false;
  lines.forEach((l, line) => {
    if (/^\s*```/.test(l)) {
      fenced = !fenced;
      return;
    }
    if (fenced) return;
    const m = /^(#{1,6}) (.*)$/.exec(l);
    if (m) out.push({ line, level: (m[1] ?? '').length, text: (m[2] ?? '').trim() });
  });
  return out;
}

function parseStandard(
  lines: string[],
  from: number,
  to: number,
  into: Map<string, CommandDoc>,
): void {
  let last: CommandDoc[] = [];
  for (let i = from; i < to; i++) {
    const raw = lines[i] ?? '';
    const top = /^- (.*)$/.exec(raw);
    if (!top) {
      // вложенные примечания (`  - Note: …`) дополняют предыдущий пункт
      const note = /^\s+(?:- )?(\S.*)$/.exec(raw);
      if (note && last.length > 0) {
        for (const c of last) c.details = `${c.details} ${cleanMd(note[1] ?? '')}`.trim();
      }
      continue;
    }

    // пункт может переноситься на следующие строки
    let item = top[1] ?? '';
    while (i + 1 < to && /^ {2,}\S/.test(lines[i + 1] ?? '') && !/^\s+- /.test(lines[i + 1] ?? '')) {
      i++;
      item += ` ${(lines[i] ?? '').trim()}`;
    }

    const usages = [...item.matchAll(/`([^`]+)`/g)].map((m) => (m[1] ?? '').trim());
    const firstTick = item.indexOf('`');
    const head = (firstTick === -1 ? item : item.slice(0, firstTick)).replace(/[:\s]+$/, '').trim();
    const description = cleanMd(head);

    const byName = new Map<string, RawParam[][]>();
    // имена из описания: «Move (G0 or G1)» — G0 в usage может не встретиться
    for (const m of head.matchAll(/\b([GM]\d+)\b/g)) {
      const n = (m[1] ?? '').toUpperCase();
      if (!byName.has(n)) byName.set(n, []);
    }
    for (const u of usages) {
      if (!/^[GMT]\d+\b/i.test(u)) continue;
      const parsed = parseUsageRaw(u);
      const key = parsed.name.toUpperCase();
      byName.set(key, [...(byName.get(key) ?? []), parsed.params]);
    }

    const sibling = [...byName.values()].find((l) => l.length > 0);
    last = [];
    for (const [name, lists] of byName) {
      const doc: CommandDoc = into.get(name) ?? {
        name,
        kind: 'standard',
        description,
        details: description,
        usages: [],
        params: [],
      };
      doc.usages.push(...usages.filter((u) => sameCommand(u.split(' ')[0] ?? '', name)));
      doc.params = mergeParams(lists.length > 0 ? lists : (sibling ?? []));
      into.set(name, doc);
      last.push(doc);
    }
  }
}

/**
 * Модульные разделы иногда перечисляют и стандартные G/M-команды обычным списком
 * (`- `M118 <message>`: …` в [respond]) — собираем их вместе с модулем.
 */
function parseModuleStandard(
  lines: string[],
  from: number,
  to: number,
  module: string | undefined,
  into: Map<string, CommandDoc>,
): void {
  for (let i = from; i < to; i++) {
    const m = /^- `((?:[GM]\d+)(?:\s[^`]*)?)`:?\s*(.*)$/i.exec(lines[i] ?? '');
    if (!m) continue;
    let desc = m[2] ?? '';
    while (i + 1 < to && /^ {2,}\S/.test(lines[i + 1] ?? '')) {
      i++;
      desc += ` ${(lines[i] ?? '').trim()}`;
    }
    const parsed = parseUsageRaw(m[1] ?? '');
    const key = parsed.name.toUpperCase();
    if (into.has(key)) continue;
    const details = cleanMd(desc);
    into.set(key, {
      name: parsed.name,
      kind: 'standard',
      module,
      description: firstSentence(details),
      details,
      usages: [(m[1] ?? '').trim()],
      params: mergeParams([parsed.params]),
    });
  }
}

function parseExtended(lines: string[], heads: Heading[], into: Map<string, CommandDoc>): void {
  let module: string | undefined;
  for (let h = 0; h < heads.length; h++) {
    const head = heads[h];
    if (!head) continue;
    if (head.level === 3 && head.text.startsWith('[')) {
      const m = /^\[([^\]]+)\]/.exec(head.text);
      module = m ? (m[1] ?? '').trim() : undefined;
      parseModuleStandard(lines, head.line + 1, heads[h + 1]?.line ?? lines.length, module, into);
      continue;
    }
    // команда обычно `#### NAME`, но в документе встречается и `### NAME` (опечатка уровня)
    const isCommand =
      head.level === 4 || (head.level === 3 && /^`?[A-Z][A-Z0-9_]+`?:?$/.test(head.text));
    if (!isCommand) continue;

    const name = head.text.replace(/`/g, '').replace(/:$/, '').trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) continue;
    const key = name.toUpperCase();
    const existing = into.get(key);
    if (existing && existing.kind === 'standard') continue;

    const nextHead = heads.slice(h + 1).find((x) => x.level <= head.level);
    const body = lines.slice(head.line + 1, nextHead ? nextHead.line : lines.length).join('\n');

    // все usage этой команды (по первому токену)
    const usages: string[] = [];
    let firstEnd = -1;
    const re = new RegExp(USAGE_RE.source, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(body))) {
      const u = (m[1] ?? '').replace(/\s+/g, ' ').trim();
      if (!sameCommand(u.split(' ')[0] ?? '', name)) continue;
      if (firstEnd === -1) firstEnd = m.index + m[0].length;
      usages.push(u);
    }

    const params = mergeParams(usages.map((u) => parseUsageRaw(u).params));

    // описание: абзац после первого usage (после `:`)
    const after = firstEnd === -1 ? body : body.slice(firstEnd).replace(/^\s*:/, '');
    const details = cleanMd(after.trim().split(/\n\s*\n/)[0] ?? '');

    // описания параметров из списков «- `NAME`: …» (с продолжением на следующих строках)
    for (const p of params) {
      const pr = new RegExp(`^[ \\t]*[-*]\\s+\`?${p.name}\`?\\s*[:\\-]\\s*(.+)$`, 'im').exec(body);
      if (!pr) continue;
      let d = pr[1] ?? '';
      const tail = body.slice(pr.index + pr[0].length).split('\n').slice(1);
      for (const c of tail) {
        if (!/^\s{3,}\S/.test(c)) break;
        d += ` ${c.trim()}`;
      }
      p.description = cleanMd(d);
    }

    if (existing) {
      // одна команда описана в нескольких модулях (SET_PIN в [output_pin] и [pwm_cycle_time]):
      // первое описание остаётся, usage и параметры объединяются
      existing.usages.push(...usages);
      existing.params = mergeParams([existing.params, params]);
      continue;
    }

    into.set(key, {
      name,
      kind: 'extended',
      module,
      description: firstSentence(details),
      details,
      usages,
      params,
    });
  }
}

export function parseGcodeDocs(text: string): GcodeDocs {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const heads = headingsOf(lines);
  const commands = new Map<string, CommandDoc>();

  const std = heads.find((h) => h.level === 2 && /^G-Code commands/i.test(h.text));
  if (std) {
    const nextH2 = heads.find((h) => h.line > std.line && h.level <= 2);
    parseStandard(lines, std.line + 1, nextH2 ? nextH2.line : lines.length, commands);
  }

  const ext = heads.find((h) => h.level === 2 && /^Additional Commands/i.test(h.text));
  if (ext) {
    const nextH2 = heads.find((h) => h.line > ext.line && h.level <= 2);
    const inRange = heads.filter((h) => h.line > ext.line && (!nextH2 || h.line < nextH2.line));
    parseExtended(lines, inRange, commands);
  }

  return { commands };
}
