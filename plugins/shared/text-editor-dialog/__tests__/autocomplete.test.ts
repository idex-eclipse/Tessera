import { describe, expect, it } from 'vitest';

import { buildCatalog } from '../../gcode-hints/catalog';
import { parseGcodeDocs } from '../../gcode-hints/gcode-docs';
import { buildObjectIndex, scanSectionNames } from '../../gcode-hints/object-names';
import { macroParamNamesAt, scanLocalMacros } from '../../gcode-hints/local-macros';
import {
  collectAllWords,
  collectJinjaVars,
  getCompletionContext,
  getSuggestions,
  isPassive,
  type CompletionSources,
} from '../autocomplete';

const DOCS = parseGcodeDocs(
  [
    '## Additional Commands',
    '### [bed_mesh]',
    '#### BED_MESH_CALIBRATE',
    '`BED_MESH_CALIBRATE [PROFILE=<name>] [ADAPTIVE=1]`: Probes the bed and builds a mesh.',
    '### [dual_carriage]',
    '#### SET_DUAL_CARRIAGE',
    '`SET_DUAL_CARRIAGE CARRIAGE=<carriage> [MODE=[PRIMARY|COPY|MIRROR]]`: Sets the active carriage.',
  ].join('\n'),
);

const CFG = [
  '[printer]',
  'kinematics: cartesian',
  '',
  '[gcode_macro START_PRINT]',
  'description: Start',
  'gcode:',
  '    {% set bed = params.BED|default(60)|float %}',
  '    G28',
  '',
  '[gcode_macro OTHER]',
  'gcode:',
  '    M117 {params.MSG}',
  '',
  '[stepper_x]',
  'step_pin: PF13',
].join('\n');

const catalog = buildCatalog({
  help: {
    BED_MESH_CALIBRATE: 'Perform Mesh Bed Leveling',
    SET_DUAL_CARRIAGE: 'Set which carriage is active',
    START_PRINT: 'Start',
    OTHER: 'G-Code macro',
  },
  docs: DOCS,
  macros: scanLocalMacros(CFG),
});

function sourcesFor(text: string, cursor: number): CompletionSources {
  return {
    jinjaVars: collectJinjaVars(text),
    allWords: collectAllWords(text),
    catalog,
    macroParams: macroParamNamesAt(text, cursor),
  };
}

/** Каретка — маркер «§» в тексте (символ «|» занят jinja-фильтрами). */
function at(src: string) {
  const cursor = src.indexOf('§');
  const text = src.replace('§', '');
  const ctx = getCompletionContext(text, cursor);
  return { text, cursor, ctx, items: ctx ? getSuggestions(ctx, sourcesFor(text, cursor)) : [] };
}

const body = (line: string) => `[gcode_macro X]\ngcode:\n    ${line}`;

describe('getCompletionContext: gcode-блок', () => {
  it('имя команды: префикс и границы токена', () => {
    const { ctx, text, cursor } = at(body('BED_ME§'));
    expect(ctx).toMatchObject({ inGcode: true, prefix: 'BED_ME', end: cursor });
    expect(text.slice(ctx!.start, ctx!.end)).toBe('BED_ME');
    expect(isPassive(ctx!)).toBe(false);
  });

  it('после пробела — пассивный список параметров с пустым префиксом', () => {
    const { ctx } = at(body('BED_MESH_CALIBRATE §'));
    expect(ctx).toMatchObject({ inGcode: true, prefix: '' });
    expect(isPassive(ctx!)).toBe(true);
  });

  it('после «=» — значение; префикс — только то, что после «=»', () => {
    const { ctx, text } = at(body('SET_DUAL_CARRIAGE CARRIAGE=1 MODE=MI§'));
    expect(ctx?.prefix).toBe('MI');
    expect(text.slice(ctx!.start, ctx!.end)).toBe('MI');
  });

  it('пустой токен на месте команды и комментарии — без подсказок', () => {
    expect(at(body('§')).ctx).toBeNull();
    expect(at(body('G1 X10 ; BED§')).ctx).toBeNull();
    expect(at(`${body('')}\n    # BED|`).ctx).toBeNull();
  });

  it('внутри строки в кавычках — без подсказок', () => {
    expect(at(body('RESPOND MSG="hello wo§')).ctx).toBeNull();
  });

  it('вне gcode пустой префикс по-прежнему null', () => {
    expect(at('[printer]\nkinematics: §').ctx).toBeNull();
    expect(at('[printer]\nkin§').ctx).toMatchObject({ inConfig: true, prefix: 'kin' });
  });

  it('SAVE_CONFIG-блок — без подсказок', () => {
    expect(at('#*# <---------------------- SAVE_CONFIG ---------------------->\n[a]\nfoo§').ctx).toBeNull();
  });

  it('jinja-режим не затронут', () => {
    expect(at(body('M117 {§')).ctx).toBeNull();
    expect(at(body('M117 {params.M§')).ctx).toMatchObject({ inJinja: true, prefix: 'params.M' });
  });
});

describe('getSuggestions: gcode-блок', () => {
  const labels = (src: string) => at(src).items.map((i) => i.label);

  it('команды: макросы помечены kind=macro, описание в detail', () => {
    expect(at(body('START§')).items[0]).toMatchObject({
      label: 'START_PRINT',
      kind: 'macro',
      detail: 'Start',
    });
    const c = at(body('BED_MESH_C§')).items[0]!;
    expect(c).toMatchObject({
      label: 'BED_MESH_CALIBRATE',
      kind: 'cmd',
      insert: 'BED_MESH_CALIBRATE ',
    });
    expect(c.detail).toMatch(/Probes the bed/);
  });

  it('сразу после пробела — параметры из G-Codes.md', () => {
    expect(labels(body('BED_MESH_CALIBRATE §'))).toEqual(['PROFILE=', 'ADAPTIVE=']);
    expect(labels(body('BED_MESH_CALIBRATE PR§'))).toEqual(['PROFILE=']);
    expect(at(body('SET_DUAL_CARRIAGE §')).items[0]).toMatchObject({
      label: 'CARRIAGE=',
      kind: 'param',
    });
  });

  it('значения-перечисления после «=»', () => {
    const r = at(body('SET_DUAL_CARRIAGE CARRIAGE=1 MODE=§')).items;
    expect(r.map((i) => i.label)).toEqual(['PRIMARY', 'COPY', 'MIRROR']);
    expect(r.every((i) => i.kind === 'value')).toBe(true);
    expect(labels(body('SET_DUAL_CARRIAGE CARRIAGE=1 MODE=CO§'))).toEqual(['COPY']);
  });

  it('параметры макроса из файла; использованные не повторяются', () => {
    expect(labels(body('START_PRINT §'))).toEqual(['BED=']);
    expect(labels(body('START_PRINT BED=60 §'))).toEqual([]);
  });

  it('слова файла — только на месте команды или как запасной вариант', () => {
    // команда ещё не набрана целиком: слово файла (макрос OTHER) предлагается
    expect(labels(body('OTH§'))).toContain('OTHER');
    // в позиции параметров слова не примешиваются
    expect(labels(body('BED_MESH_CALIBRATE PROFILE=def§'))).toEqual([]);
    // у неизвестной команды каталог пуст — работают слова файла
    expect(labels(CFG.replace('G28', 'UNKNOWN_THING kinema§'))).toContain('kinematics');
  });

  it('набранная целиком команда: без параметров не предлагается, с параметрами — подставит пробел', () => {
    expect(labels(body('M107§'))).not.toContain('M107'); // команда без параметров
    expect(at(body('BED_MESH_CALIBRATE§')).items[0]).toMatchObject({
      label: 'BED_MESH_CALIBRATE',
      insert: 'BED_MESH_CALIBRATE ',
    });
  });

  it('G1 X10: буквенные параметры не предлагаются', () => {
    expect(labels(body('G1 §'))).toEqual([]);
    expect(labels(body('G1 X10 §'))).toEqual([]);
  });

  it('limit соблюдается', () => {
    const { ctx, text, cursor } = at(body('B§'));
    expect(getSuggestions(ctx!, sourcesFor(text, cursor), 1)).toHaveLength(1);
  });
});

describe('getSuggestions: jinja и params.', () => {
  it('params. внутри макроса — параметры именно этого макроса', () => {
    const src = CFG.replace('M117 {params.MSG}', 'M117 {params.MSG} {params.§}');
    const r = at(src);
    expect(r.ctx?.inJinja).toBe(true);
    // курсор в макросе OTHER: его параметры, а не BED из START_PRINT
    expect(r.items.map((i) => i.label)).toEqual(['params.MSG']);
    expect(collectJinjaVars(r.text)).toContain('params.BED'); // глобальный список по-прежнему есть
  });

  it('вне макроса params. берётся из файла целиком', () => {
    const r = at(CFG.replace('step_pin: PF13', 'step_pin: {params.B§}'));
    expect(r.items.map((i) => i.label)).toEqual(['params.BED']);
  });
});

describe('имена объектов', () => {
  const OBJ_DOCS = parseGcodeDocs(
    [
      '## Additional Commands',
      '### [fan_generic]',
      '#### SET_FAN_SPEED',
      '`SET_FAN_SPEED FAN=config_name SPEED=<speed>`: Sets the fan speed.',
      '### [gcode_macro]',
      '#### SET_GCODE_VARIABLE',
      '`SET_GCODE_VARIABLE MACRO=<macro_name> VARIABLE=<name> VALUE=<value>`: Changes a variable.',
    ].join('\n'),
  );
  const FILE = [
    '[fan_generic cooling]',
    'pin: PA1',
    '[fan_generic Case Fan]',
    'pin: PA2',
    '[heater_generic chamber]',
    '[gcode_macro CLEAN]',
    'variable_count: 0',
    'variable_state: idle',
    'gcode:',
    '    SET_FAN_SPEED FAN=',
    '    M117 {printer.}',
  ].join('\n');

  const objCatalog = buildCatalog({
    help: { SET_FAN_SPEED: 'x', SET_GCODE_VARIABLE: 'x' },
    docs: OBJ_DOCS,
    macros: [],
  });

  function atObj(src: string, objects?: string[]) {
    const cursor = src.indexOf('§');
    const text = src.replace('§', '');
    const ctx = getCompletionContext(text, cursor);
    const macros = scanLocalMacros(text);
    const sections = scanSectionNames(text);
    const index = buildObjectIndex({ sections, macros, objects });
    const items = ctx
      ? getSuggestions(ctx, {
          jinjaVars: collectJinjaVars(text),
          allWords: collectAllWords(text),
          catalog: objCatalog,
          macroParams: macroParamNamesAt(text, cursor),
          objects: index,
        })
      : [];
    return { text, cursor, ctx, items };
  }

  it('FAN= в gcode-блоке: секции из этого же файла, имя с пробелом в кавычках', () => {
    const r = atObj(FILE.replace('SET_FAN_SPEED FAN=', 'SET_FAN_SPEED FAN=§'));
    expect(r.ctx).toMatchObject({ inGcode: true, prefix: '' });
    expect(r.items.map((i) => [i.label, i.insert, i.kind])).toEqual([
      ['cooling', 'cooling', 'value'],
      ['Case Fan', '"Case Fan"', 'value'],
    ].sort((a, b) => a[0]!.localeCompare(b[0]!)));
    expect(r.items[0]!.detail).toBe('fan_generic');
  });

  it('VARIABLE= берёт переменные макроса из MACRO= на строке', () => {
    const r = atObj(FILE.replace('SET_FAN_SPEED FAN=', 'SET_GCODE_VARIABLE MACRO=CLEAN VARIABLE=§'));
    expect(r.items.map((i) => i.label)).toEqual(['count', 'state']);
  });

  it('printer[" — имена объектов, закрывающие кавычка и ] дописываются', () => {
    const objs = ['toolhead', 'fan_generic cooling', 'heater_generic chamber', 'extruder'];
    const r = atObj(FILE.replace('M117 {printer.}', 'M117 {printer["§'), objs);
    expect(r.ctx).toMatchObject({ inJinja: true, jinjaKind: 'bracket', prefix: '' });
    expect(isPassive(r.ctx!)).toBe(true);
    expect(r.items.map((i) => i.label)).toEqual([
      'extruder',
      'fan_generic cooling',
      'heater_generic chamber',
      'toolhead',
    ]);
    expect(r.items[1]).toMatchObject({ insert: 'fan_generic cooling"]', detail: 'fan_generic' });
  });

  it('printer[" с префиксом и уже стоящей кавычкой после каретки', () => {
    const objs = ['fan_generic cooling', 'fan_generic aux'];
    const r = atObj(FILE.replace('M117 {printer.}', 'M117 {printer["fan_generic c§"]}'), objs);
    expect(r.items.map((i) => [i.label, i.insert])).toEqual([['fan_generic cooling', 'fan_generic cooling']]);
    // кавычка и ] уже на месте: ничего не дописываем
    const r2 = atObj(FILE.replace('M117 {printer.}', 'M117 {printer["fan_generic c§"]}'), objs);
    expect(r2.ctx?.closing).toBe('');
  });

  it("printer['…: одинарные кавычки сохраняются", () => {
    const r = atObj(FILE.replace('M117 {printer.}', "M117 {printer['§"), ['fan_generic aux']);
    expect(r.items[0]!.insert).toBe("fan_generic aux']");
  });

  it('printer["gcode_macro CLEAN"].<переменная> — переменные без variable_', () => {
    const r = atObj(FILE.replace('M117 {printer.}', 'M117 {printer["gcode_macro CLEAN"].§'));
    expect(r.ctx).toMatchObject({ jinjaKind: 'macroVar', macro: 'CLEAN', prefix: '' });
    expect(r.items.map((i) => i.label)).toEqual(['count', 'state']);
    const r2 = atObj(FILE.replace('M117 {printer.}', 'M117 {printer["gcode_macro CLEAN"].st§'));
    expect(r2.items.map((i) => i.label)).toEqual(['state']);
  });

  it('printer.<префикс>: идентификаторы как printer.x, имена с пробелом как printer["…"]', () => {
    const objs = ['extruder', 'fan_generic cooling', 'fan', 'toolhead'];
    const r = atObj(FILE.replace('M117 {printer.}', 'M117 {printer.f§}'), objs);
    expect(r.items.map((i) => i.label)).toEqual(['printer.fan', 'printer["fan_generic cooling"]']);
    const r2 = atObj(FILE.replace('M117 {printer.}', 'M117 {printer.§}'), objs);
    expect(r2.items.map((i) => i.label)).toEqual(
      expect.arrayContaining(['printer.extruder', 'printer.fan', 'printer.toolhead', 'printer["fan_generic cooling"]']),
    );
  });

  it('прежние jinja-сценарии не затронуты: params. и пустой префикс вне printer[', () => {
    expect(atObj(FILE.replace('M117 {printer.}', 'M117 {§')).ctx).toBeNull();
    expect(atObj(FILE.replace('M117 {printer.}', 'M117 {params.§}')).ctx?.jinjaKind).toBeUndefined();
  });
});
