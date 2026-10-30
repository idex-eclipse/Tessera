/**
 * Каталог команд принтера: объединяет три источника.
 *  - `printer.gcode.help` — какие команды реально есть на принтере (и их описания);
 *  - `G-Codes.md` — параметры, перечисления значений, модуль и описание;
 *  - макросы — из конфига принтера и (в редакторе) из редактируемого файла.
 */
import type { MacroParam } from '../macro-params';
import type { MacroSource } from './local-macros';
import type { Catalog, CommandInfo, GcodeDocs, ParamInfo } from './types';

/** Описание макроса по умолчанию, которое Klipper подставляет сам. */
const DEFAULT_MACRO_DESCRIPTION = 'G-Code macro';

/**
 * Запасная таблица стандартных команд: `printer.gcode.help` их не содержит, а пока
 * G-Codes.md недоступен (старый Moonraker, нет root `docs`) подсказывать иначе нечего.
 * Описания даёт документ.
 */
const FALLBACK_STANDARD: ReadonlyArray<readonly [string, string]> = [
  ['G0', 'X Y Z E F'],
  ['G1', 'X Y Z E F'],
  ['G2', 'X Y I J E F'],
  ['G3', 'X Y I J E F'],
  ['G4', 'P'],
  ['G28', 'X Y Z'],
  ['G90', ''],
  ['G91', ''],
  ['G92', 'X Y Z E'],
  ['M82', ''],
  ['M83', ''],
  ['M84', ''],
  ['M104', 'T S'],
  ['M105', ''],
  ['M106', 'S'],
  ['M107', ''],
  ['M109', 'T S'],
  ['M112', ''],
  ['M114', ''],
  ['M115', ''],
  ['M117', ''],
  ['M140', 'S'],
  ['M190', 'S'],
  ['M204', 'S P T'],
  ['M220', 'S'],
  ['M221', 'S'],
  ['M400', ''],
];

function letterParams(sig: string): ParamInfo[] {
  return sig
    .split(' ')
    .filter(Boolean)
    .map((name) => ({
      name,
      style: 'letter' as const,
      optional: true,
      required: false,
      valueKind: 'number' as const,
    }));
}

function macroParamInfo(p: MacroParam): ParamInfo {
  return {
    name: p.name,
    style: 'named',
    optional: !p.required,
    required: p.required,
    valueKind: p.type === 'string' ? 'text' : 'number',
    type: p.type,
    def: p.def,
  };
}

export interface CatalogInput {
  /** результат `printer.gcode.help`; null — ещё не загружен */
  help: Record<string, string> | null;
  docs: GcodeDocs | null;
  /** макросы из конфига принтера */
  macros: MacroSource[];
}

export function buildCatalog(input: CatalogInput): Catalog {
  const catalog: Catalog = new Map();
  const { help, docs } = input;

  for (const [name, sig] of FALLBACK_STANDARD) {
    catalog.set(name, { name, kind: 'standard', params: letterParams(sig) });
  }

  if (docs) {
    for (const [key, d] of docs.commands) {
      if (d.kind === 'standard') {
        catalog.set(key, {
          name: d.name,
          kind: 'standard',
          description: d.description,
          details: d.details,
          module: d.module,
          params: d.params,
        });
      } else if (help === null) {
        // help ещё нет — показываем всё, что знает документ
        catalog.set(key, toInfo(d));
      }
    }
  }

  if (help) {
    for (const [name, text] of Object.entries(help)) {
      const key = name.toUpperCase();
      const d = docs?.commands.get(key);
      if (d && d.kind === 'extended') {
        catalog.set(key, { ...toInfo(d), name, description: d.description || text || undefined });
      } else {
        // команда, о которой документ не знает (плагин, макрос): только имя и описание из help
        catalog.set(key, {
          name,
          kind: 'extended',
          description: text && text !== DEFAULT_MACRO_DESCRIPTION ? text : undefined,
          params: [],
        });
      }
    }
  }

  applyMacros(catalog, input.macros, help);
  return catalog;
}

function toInfo(d: { name: string; description: string; details: string; module?: string; params: ParamInfo[] }): CommandInfo {
  return {
    name: d.name,
    kind: 'extended',
    description: d.description,
    details: d.details,
    module: d.module,
    params: d.params,
  };
}

function applyMacros(
  catalog: Catalog,
  macros: MacroSource[],
  help: Record<string, string> | null,
): void {
  const helpKeys = help ? Object.keys(help) : [];
  for (const m of macros) {
    const key = m.name.toUpperCase();
    // имя берём в написании help (так его видит Klipper), иначе как в конфиге
    const name = helpKeys.find((k) => k.toUpperCase() === key) ?? m.name;
    const description =
      m.description && m.description !== DEFAULT_MACRO_DESCRIPTION ? m.description : undefined;
    catalog.set(key, {
      name,
      kind: 'macro',
      description: description ?? catalog.get(key)?.description,
      params: m.params.map(macroParamInfo),
    });
  }
}

/** Каталог принтера + макросы из редактируемого файла (они перекрывают данные принтера). */
export function mergeLocalMacros(base: Catalog, local: MacroSource[]): Catalog {
  if (local.length === 0) return base;
  const next: Catalog = new Map(base);
  const helpKeys = new Map<string, string>();
  for (const [k, v] of base) helpKeys.set(k, v.name);
  for (const m of local) {
    const key = m.name.toUpperCase();
    const description =
      m.description && m.description !== DEFAULT_MACRO_DESCRIPTION ? m.description : undefined;
    next.set(key, {
      name: helpKeys.get(key) ?? m.name,
      kind: 'macro',
      description: description ?? base.get(key)?.description,
      params: m.params.map(macroParamInfo),
    });
  }
  return next;
}

/** `X Y Z E F` — сигнатура буквенных параметров стандартной команды. */
export function letterSignature(info: CommandInfo): string {
  return info.params
    .filter((p) => p.style === 'letter')
    .map((p) => p.name)
    .join(' ');
}

/** Именованные параметры (`NAME=`): только они подставляются подсказками. */
export function namedParams(info: CommandInfo): ParamInfo[] {
  return info.params.filter((p) => p.style === 'named');
}

/** Короткая подпись типа параметра для списка подсказок: `0|1`, `float`, `config_name`. */
export function paramTypeLabel(p: ParamInfo): string {
  if (p.choices && p.choices.length > 0) {
    const shown = p.choices.slice(0, 4).join('|');
    return p.choices.length > 4 ? `${shown}|…` : shown;
  }
  return p.type ?? p.hint ?? '';
}
