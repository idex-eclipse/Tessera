/**
 * Имена объектов принтера для подсказок значений (`FAN=`, `HEATER=`, `STEPPER=`…)
 * и для jinja (`printer["heater_generic chamber"]`).
 *
 * Имена берутся из секций конфигурации (`printer.objects.query { configfile }`) и
 * из редактируемого файла. Одно и то же подсказочное слово в G-Codes.md (`config_name`)
 * означает разные объекты в разных командах, поэтому соответствие задано таблицей
 * «команда + параметр → набор секций».
 */
import type { MacroSource } from './local-macros';

export interface ObjectEntry {
  /** секция целиком: `fan_generic cooling`, `extruder` */
  section: string;
  /** первое слово секции: `fan_generic` */
  type: string;
  /** часть после первого пробела (`cooling`) или вся секция, если пробела нет */
  name: string;
}

export interface ObjectIndexInput {
  sections: string[];
  macros: MacroSource[];
  /** результат `printer.objects.list` (нужен для jinja) */
  objects?: string[];
}

export interface ObjectIndex {
  entries: ObjectEntry[];
  /** UPPER-имя макроса → его `variable_*` без префикса */
  variables: Map<string, string[]>;
  /** имена объектов для `printer[...]`: `printer.objects.list`, иначе секции */
  objects: string[];
  /** исходные данные — для слияния с секциями редактируемого файла */
  input: ObjectIndexInput;
}

export interface NameCandidate {
  value: string;
  /** тип секции для показа в списке */
  detail: string;
}

export interface ResolvedNames {
  names: NameCandidate[];
  /** значение — список (`CHIPS=a,b`): подбор идёт по последнему элементу */
  separator?: string;
}

export type NameResolver = (
  command: string,
  param: string,
  values: Record<string, string>,
) => ResolvedNames | null;

// ----------------------------------------------------------------------
// индекс
// ----------------------------------------------------------------------

function normSection(s: string): string {
  return s.trim().replace(/\s+/g, ' ');
}

function toEntry(section: string): ObjectEntry {
  const sp = section.indexOf(' ');
  return sp === -1
    ? { section, type: section, name: section }
    : { section, type: section.slice(0, sp), name: section.slice(sp + 1).trim() };
}

function uniqueCI(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of list) {
    const k = s.toLowerCase();
    if (!s || seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

export function buildObjectIndex(input: ObjectIndexInput): ObjectIndex {
  const sections = uniqueCI(input.sections.map(normSection));
  const variables = new Map<string, string[]>();
  for (const m of input.macros) {
    if (m.variables && m.variables.length > 0) variables.set(m.name.toUpperCase(), m.variables);
  }
  const objects = input.objects && input.objects.length > 0 ? uniqueCI(input.objects) : sections;
  return { entries: sections.map(toEntry), variables, objects, input };
}

/** Данные принтера + секции и макросы из редактируемого файла (последние дополняют и перекрывают). */
export function mergeObjectIndex(
  base: ObjectIndex,
  local: { sections: string[]; macros: MacroSource[] },
): ObjectIndex {
  if (local.sections.length === 0 && local.macros.length === 0) return base;
  const localMacroNames = new Set(local.macros.map((m) => m.name.toUpperCase()));
  return buildObjectIndex({
    sections: [...base.input.sections, ...local.sections],
    macros: [
      ...base.input.macros.filter((m) => !localMacroNames.has(m.name.toUpperCase())),
      ...local.macros,
    ],
    objects: base.input.objects ? [...base.input.objects, ...local.sections] : undefined,
  });
}

/** Имена секций текста (`[fan_generic cooling]` в первой колонке). */
export function scanSectionNames(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split('\n')) {
    const m = /^\[([^\]]+)\]/.exec(line);
    if (m) out.push(normSection(m[1] ?? ''));
  }
  return out;
}

// ----------------------------------------------------------------------
// правила
// ----------------------------------------------------------------------

interface Source {
  /** секции вида «тип имя» (или «тип» без имени) с одним из этих типов → имя */
  types?: string[];
  /** секции без пробела, имя которых подходит под выражение → вся секция */
  exact?: RegExp;
  /** брать только секции с именем (профили `bed_mesh <профиль>`, не сам `[bed_mesh]`) */
  requireName?: boolean;
  /** секции драйверов `tmc2209 stepper_x` → имя шаговика */
  tmc?: boolean;
}

interface Rule {
  command?: RegExp;
  params: string[];
  sources?: Source[];
  separator?: string;
  /** подсказывать переменные макроса, имя которого введено в этом параметре */
  variablesOf?: string;
}

const HEATERS: Source = { exact: /^(extruder\d*|heater_bed)$/ };
const HEATER_GENERIC: Source = { types: ['heater_generic'] };
const EXTRUDERS: Source = { exact: /^extruder\d*$/ };
const ACCELEROMETERS: Source = {
  types: ['adxl345', 'lis2dw', 'lis3dh', 'mpu9250', 'icm20948', 'bmi160'],
};

// Первое подходящее правило выигрывает: командные раньше общих.
const RULES: Rule[] = [
  { params: ['FAN'], sources: [{ types: ['fan_generic'] }] },
  { params: ['HEATER'], sources: [HEATERS, HEATER_GENERIC] },
  {
    command: /^TEMPERATURE_WAIT$/,
    params: ['SENSOR'],
    sources: [
      HEATERS,
      HEATER_GENERIC,
      { types: ['temperature_sensor', 'temperature_fan', 'temperature_probe'] },
    ],
  },
  {
    command: /FILAMENT_SENSOR$/,
    params: ['SENSOR'],
    sources: [{ types: ['filament_switch_sensor', 'filament_motion_sensor'] }],
  },
  { command: /^SYNC_EXTRUDER_MOTION$/, params: ['MOTION_QUEUE'], sources: [EXTRUDERS] },
  { params: ['EXTRUDER'], sources: [EXTRUDERS, { types: ['extruder_stepper'] }] },
  { command: /^MANUAL_STEPPER$/, params: ['STEPPER'], sources: [{ types: ['manual_stepper'] }] },
  {
    command: /^(DUMP_TMC|INIT_TMC|SET_TMC_CURRENT|SET_TMC_FIELD)$/,
    params: ['STEPPER'],
    sources: [{ tmc: true }],
  },
  { params: ['STEPPER'], sources: [{ exact: /^(stepper_[a-z]+\d*|extruder\d*)$/ }] },
  { params: ['PIN'], sources: [{ types: ['output_pin', 'pwm_tool', 'pwm_cycle_time'] }] },
  { params: ['SERVO'], sources: [{ types: ['servo'] }] },
  {
    params: ['LED'],
    sources: [{ types: ['led', 'neopixel', 'dotstar', 'pca9533', 'pca9632'] }],
  },
  { command: /^ANGLE_/, params: ['CHIP'], sources: [{ types: ['angle'] }] },
  { params: ['CHIP'], sources: [ACCELEROMETERS] },
  { params: ['CHIPS'], sources: [ACCELEROMETERS], separator: ',' },
  { params: ['DIGIPOT'], sources: [{ types: ['ad5206', 'mcp4451', 'mcp4728', 'mcp4018'] }] },
  { command: /^UPDATE_DELAYED_GCODE$/, params: ['ID'], sources: [{ types: ['delayed_gcode'] }] },
  {
    command: /^BED_MESH_PROFILE$/,
    params: ['LOAD', 'REMOVE'],
    sources: [{ types: ['bed_mesh'], requireName: true }],
  },
  {
    command: /^BED_MESH_CALIBRATE$/,
    params: ['PROFILE'],
    sources: [{ types: ['bed_mesh'], requireName: true }],
  },
  {
    command: /^SKEW_PROFILE$/,
    params: ['LOAD', 'REMOVE'],
    sources: [{ types: ['skew_correction'], requireName: true }],
  },
  { params: ['LOAD_CELL'], sources: [{ types: ['load_cell'] }] },
  { command: /^SET_GCODE_VARIABLE$/, params: ['MACRO'], sources: [{ types: ['gcode_macro'] }] },
  { command: /^SET_GCODE_VARIABLE$/, params: ['VARIABLE'], variablesOf: 'MACRO' },
  { params: ['TEMPLATE'], sources: [{ types: ['display_template'] }] },
  {
    command: /^TEMPERATURE_PROBE_CALIBRATE$/,
    params: ['PROBE'],
    sources: [{ types: ['temperature_probe'] }],
  },
];

function fromSource(index: ObjectIndex, src: Source): NameCandidate[] {
  const out: NameCandidate[] = [];
  for (const e of index.entries) {
    const hasName = e.section.includes(' ');
    const type = e.type.toLowerCase();
    if (src.types?.includes(type)) {
      if (src.requireName && !hasName) continue;
      out.push({ value: e.name, detail: e.type });
    } else if (src.exact && !hasName && src.exact.test(e.section)) {
      out.push({ value: e.section, detail: e.type });
    } else if (src.tmc && hasName && /^tmc\d+\w*$/i.test(e.type)) {
      out.push({ value: e.name, detail: e.type });
    }
  }
  return out;
}

function sortedUnique(list: NameCandidate[]): NameCandidate[] {
  const seen = new Set<string>();
  const out: NameCandidate[] = [];
  for (const c of [...list].sort((a, b) => a.value.localeCompare(b.value))) {
    const k = c.value.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(c);
  }
  return out;
}

/**
 * Имена, подходящие параметру команды. `null` — для этой пары подсказок нет
 * (имя придумывает пользователь: `SAVE_GCODE_STATE NAME=`, `BED_MESH_PROFILE SAVE=`).
 * `values` — уже введённые на строке `ИМЯ=значение` (в верхнем регистре ключей).
 */
export function resolveNames(
  index: ObjectIndex,
  command: string,
  param: string,
  values: Record<string, string> = {},
): ResolvedNames | null {
  const cmd = command.toUpperCase();
  const p = param.toUpperCase();
  const rule = RULES.find(
    (r) => r.params.includes(p) && (!r.command || r.command.test(cmd)),
  );
  if (!rule) return null;

  if (rule.variablesOf) {
    const macro = (values[rule.variablesOf] ?? '').toUpperCase();
    const vars = index.variables.get(macro) ?? [];
    return { names: sortedUnique(vars.map((v) => ({ value: v, detail: 'variable' }))) };
  }

  const names = sortedUnique((rule.sources ?? []).flatMap((s) => fromSource(index, s)));
  return rule.separator ? { names, separator: rule.separator } : { names };
}

export function makeNameResolver(index: ObjectIndex): NameResolver {
  return (command, param, values) => resolveNames(index, command, param, values);
}

/** Значение для G-code: имена с пробелом передаются в кавычках. */
export function quoteValue(value: string): string {
  return /\s/.test(value) ? `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"` : value;
}

// ----------------------------------------------------------------------
// jinja
// ----------------------------------------------------------------------

/** Имена объектов для `printer[...]` / `printer.…`. */
export function jinjaObjectNames(index: ObjectIndex): string[] {
  return [...index.objects].sort((a, b) => a.localeCompare(b));
}

/** Как обратиться к объекту в jinja: `printer.extruder` или `printer["fan_generic cooling"]`. */
export function printerRef(name: string): string {
  return /^[A-Za-z_]\w*$/.test(name) ? `printer.${name}` : `printer["${name}"]`;
}

/** Переменные макроса (без `variable_`) — `printer["gcode_macro X"].<переменная>`. */
export function macroVariables(index: ObjectIndex, macro: string): string[] {
  return index.variables.get(macro.trim().toUpperCase()) ?? [];
}
