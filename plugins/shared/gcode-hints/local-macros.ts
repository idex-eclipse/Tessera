/**
 * Макросы из текста редактируемого конфига. Правки в файле ещё не попали в конфиг
 * принтера, поэтому редактор разбирает свой текст сам и накладывает его поверх данных
 * принтера.
 */
import { parseMacroParams, type MacroParam } from '../macro-params';

export interface MacroSource {
  /** имя после `gcode_macro` в том написании, в каком оно в конфиге */
  name: string;
  description: string;
  params: MacroParam[];
  /** `variable_*` макроса без префикса (так они видны в jinja и в SET_GCODE_VARIABLE) */
  variables?: string[];
}

interface Block extends MacroSource {
  /** индексы строк [from, to) всего раздела макроса */
  from: number;
  to: number;
}

const MACRO_HEADER_RE = /^\[\s*gcode_macro\s+([^\]\s]+)\s*\]/i;

function scan(text: string): Block[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];

  let cur: {
    name: string;
    from: number;
    description: string;
    body: string[];
    variables: string[];
    inBody: boolean;
  } | null = null;
  const close = (to: number): void => {
    if (!cur) return;
    blocks.push({
      name: cur.name,
      description: cur.description,
      params: parseMacroParams(cur.body.join('\n')),
      variables: cur.variables,
      from: cur.from,
      to,
    });
    cur = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i] ?? '';

    // новый раздел (в Klipper заголовок секции — в первой колонке)
    if (/^\[/.test(ln)) {
      close(i);
      const m = MACRO_HEADER_RE.exec(ln);
      if (m) {
        cur = {
          name: m[1] ?? '',
          from: i,
          description: '',
          body: [],
          variables: [],
          inBody: false,
        };
      }
      continue;
    }
    if (!cur) continue;

    // комментарии в первой колонке игнорируются конфигом и значения не прерывают
    if (/^[#;]/.test(ln)) continue;

    const key = /^([A-Za-z_][\w]*)\s*[:=]\s*(.*)$/.exec(ln);
    if (key) {
      const k = (key[1] ?? '').toLowerCase();
      cur.inBody = k === 'gcode';
      if (k === 'gcode') cur.body.push(key[2] ?? '');
      else if (k === 'description') cur.description = (key[2] ?? '').trim();
      else if (k.startsWith('variable_') && k.length > 'variable_'.length) {
        cur.variables.push(k.slice('variable_'.length));
      }
      continue;
    }
    // продолжение значения (отступ или пустая строка)
    if (cur.inBody) cur.body.push(ln);
  }
  close(lines.length);
  return blocks;
}

/** Все `[gcode_macro NAME]` текста с описанием и параметрами из тела `gcode:`. */
export function scanLocalMacros(text: string): MacroSource[] {
  return scan(text).map(({ name, description, params, variables }) => ({
    name,
    description,
    params,
    variables,
  }));
}

/**
 * Имена параметров макроса, в теле которого стоит каретка (`params.X` внутри него);
 * null — каретка вне макроса.
 */
export function macroParamNamesAt(text: string, cursor: number): string[] | null {
  const line = text.slice(0, cursor).split('\n').length - 1;
  const hit = scan(text).find((b) => line >= b.from && line < b.to);
  return hit ? hit.params.map((p) => p.name) : null;
}
