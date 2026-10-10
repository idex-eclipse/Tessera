/**
 * Параметры макросов: парсинг params.<VAR> из тела макроса
 * (printer.configfile.config['gcode_macro <NAME>'].gcode) + сборка команды.
 * Чистый модуль без Svelte — тестируем и переиспользуем без стора.
 */

export interface MacroParam {
  name: string;
  type: 'int' | 'float' | 'string';
  def: string | null; // литерал для placeholder; null — дефолта нет
  required: boolean;  // дефолта нет ни в одном вхождении
}

const PARAM_RE =
  /params\s*(?:\.\s*([A-Za-z_]\w*)|\[\s*['"]([A-Za-z_]\w*)['"]\s*\])((?:\s*\|\s*[A-Za-z_]\w+\s*(?:\((?:[^()]*)\))?)*)/g;

/** ';'/'#' вне строк и вне {...} — как в gcode-подсветке. */
function cutComment(line: string): string {
  let inStr: string | null = null;
  let depth = 0;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inStr) {
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'") {
      inStr = c;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') depth = Math.max(0, depth - 1);
    else if ((c === ';' || c === '#') && depth === 0) return line.slice(0, i);
  }
  return line;
}

function stripComments(src: string): string {
  return src
    .replace(/\{#[\s\S]*?#\}/g, '')
    .split('\n')
    .map(cutComment)
    .join('\n');
}

/** Идиомы опциональности без дефолта:
 *  'X' in params · params.X is defined · params.get('X' … */
function hasOptionalMarker(src: string, name: string): boolean {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const membership = new RegExp(`['"]${esc}['"]\\s+in\\s+params`, 'i');
  const defined = new RegExp(
    `params\\s*\\.\\s*${esc}\\b[^%\\n;]*?\\bis\\s+(?:not\\s+)?defined`,
    'i',
  );
  const getCall = new RegExp(`params\\s*\\.\\s*get\\s*\\(\\s*['"]${esc}['"]`, 'i');
  return membership.test(src) || defined.test(src) || getCall.test(src);
}

function literalOrNone(arg: string): string | null {
  const first = arg.split(',')[0].trim();
  if (!first) return null;
  const q = /^'([\s\S]*)'$/.exec(first) ?? /^"([\s\S]*)"$/.exec(first);
  if (q) return q[1] ?? '';
  if (/^-?\d+(?:\.\d+)?$/.test(first)) return first;
  if (first === 'true' || first === 'false') return first;
  return null; // выражение (printer.… и т.п.) — placeholder не показываем
}

function parseChain(chain: string): { type: MacroParam['type']; def: string | null } {
  let type: MacroParam['type'] = 'string';
  let def: string | null = null;
  const re = /\|\s*([A-Za-z_]\w+)\s*(?:\(([^()]*)\))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(chain))) {
    const fn = (m[1] ?? '').toLowerCase();
    const arg = (m[2] ?? '').trim();
    if (fn === 'float') type = 'float';
    else if (fn === 'int' && type !== 'float') type = 'int';
    else if (fn === 'default' && def === null && arg) def = literalOrNone(arg);
  }
  return { type, def };
}

export function parseMacroParams(gcode: string): MacroParam[] {
  const byName = new Map<
    string,
    { type: MacroParam['type']; def: string | null; seenDef: boolean }
  >();
  const src = stripComments(gcode);
  PARAM_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PARAM_RE.exec(src))) {
    const name = m[1] ?? m[2];
    if (!name) continue;
    const { type, def } = parseChain(m[3] ?? '');
    const cur = byName.get(name) ?? { type: 'string', def: null, seenDef: false };
    if (type === 'float') cur.type = 'float';
    else if (type === 'int' && cur.type !== 'float') cur.type = 'int';
    if (def !== null && !cur.seenDef) {
      cur.def = def;
      cur.seenDef = true;
    }
    byName.set(name, cur);
  }
  return Array.from(byName.entries()).map(([name, v]) => ({
    name,
    type: v.type,
    def: v.def,
    required: !v.seenDef && !hasOptionalMarker(src, name),
  }));
}

/** Пустое значение → параметр не передаётся (сработает jinja-default макроса). */
export function buildMacroScript(
  name: string,
  params: MacroParam[],
  values: Record<string, string>,
): string {
  const parts: string[] = [name];
  for (const p of params) {
    const v = (values[p.name] ?? '').trim();
    if (!v) continue;
    parts.push(
      /\s/.test(v)
        ? `${p.name}="${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
        : `${p.name}=${v}`,
    );
  }
  return parts.join(' ');
}