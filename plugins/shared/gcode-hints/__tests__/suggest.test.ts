import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { buildCatalog } from '../catalog';
import { parseGcodeDocs } from '../gcode-docs';
import { buildObjectIndex, makeNameResolver } from '../object-names';
import { completionTokenStart, suggestForLine } from '../suggest';

const docs = parseGcodeDocs(
  readFileSync(resolve(__dirname, 'fixtures/g-codes.sample.md'), 'utf8'),
);

const catalog = buildCatalog({
  help: {
    BED_MESH_CALIBRATE: 'Perform Mesh Bed Leveling',
    BED_MESH_CLEAR: 'Clear the Mesh so no z-adjustment is made',
    SET_PIN: 'Set the value of an output pin',
    SET_DUAL_CARRIAGE: 'Set which carriage is active',
    SET_FILAMENT_SENSOR: 'Sets the filament sensor on/off',
    RESPOND: 'Respond',
    START_PRINT: 'Start the print',
    CLEAN_NOZZLE: 'G-Code macro',
  },
  docs,
  macros: [
    {
      name: 'START_PRINT',
      description: 'Start the print',
      params: [
        { name: 'BED', type: 'float', def: '60', required: false },
        { name: 'EXTRUDER', type: 'int', def: null, required: true },
        { name: 'MATERIAL', type: 'string', def: 'PLA', required: false },
      ],
    },
    { name: 'CLEAN_NOZZLE', description: '', params: [] },
  ],
});

const labels = (line: string, opts = {}) => suggestForLine(catalog, line, opts).items.map((i) => i.label);

describe('имя команды', () => {
  it('префикс без учёта регистра, затем подстрока (консоль)', () => {
    expect(labels('bed_mesh_c')).toEqual(['BED_MESH_CALIBRATE', 'BED_MESH_CLEAR']);
    expect(labels('MESH', { substring: true })).toEqual(['BED_MESH_CALIBRATE', 'BED_MESH_CLEAR']);
    expect(labels('MESH')).toEqual([]); // без substring подстрока не ищется
  });

  it('префиксные совпадения идут раньше подстрочных', () => {
    const r = labels('S', { substring: true });
    const firstSub = r.findIndex((n) => !n.startsWith('S'));
    expect(firstSub).toBeGreaterThan(0);
    expect(r.slice(0, firstSub).every((n) => n.startsWith('S'))).toBe(true);
    expect(r.slice(firstSub).some((n) => n.startsWith('S'))).toBe(false);
    expect(r).toContain('BED_MESH_CALIBRATE'); // содержит «S»
  });

  it('insert: пробел после команды с параметрами, у команды без параметров — нет', () => {
    const r = suggestForLine(catalog, 'START_PR').items[0]!;
    expect(r.insert).toBe('START_PRINT ');
    expect(suggestForLine(catalog, 'CLEAN_NOZ').items[0]!.insert).toBe('CLEAN_NOZZLE');
    expect(suggestForLine(catalog, 'G2').items.map((i) => i.insert)).toContain('G28 ');
  });

  it('skipExact: набранная целиком команда без параметров не предлагается', () => {
    expect(labels('CLEAN_NOZZLE', { skipExact: true })).toEqual([]);
    expect(labels('START_PRINT', { skipExact: true })).toEqual(['START_PRINT']); // подставит пробел
    expect(labels('CLEAN_NOZZLE')).toEqual(['CLEAN_NOZZLE']);
  });

  it('limit и начальные пробелы (replaceStart)', () => {
    expect(labels('S', { limit: 3 })).toHaveLength(3);
    const r = suggestForLine(catalog, '    START_PR');
    expect(r.replaceStart).toBe(4);
    expect(r.passive).toBe(false);
  });

  it('пустая строка и неизвестная команда', () => {
    expect(suggestForLine(catalog, '').items).toEqual([]);
    expect(suggestForLine(catalog, '   ').items).toEqual([]);
    expect(suggestForLine(catalog, 'UNKNOWN_CMD ').items).toEqual([]);
  });
});

describe('параметры', () => {
  it('сразу после пробела: обязательные первыми, passive=true', () => {
    const r = suggestForLine(catalog, 'START_PRINT ');
    expect(r.items.map((i) => i.label)).toEqual(['EXTRUDER=', 'BED=', 'MATERIAL=']);
    expect(r.passive).toBe(true);
    expect(r.replaceStart).toBe('START_PRINT '.length);
    expect(r.items.every((i) => i.kind === 'param')).toBe(true);
  });

  it('фильтр по набранному, без учёта регистра', () => {
    const r = suggestForLine(catalog, 'start_print be');
    expect(r.items.map((i) => i.label)).toEqual(['BED=']);
    expect(r.passive).toBe(false);
    expect(r.replaceStart).toBe('start_print '.length);
  });

  it('уже использованные параметры не повторяются', () => {
    expect(labels('START_PRINT EXTRUDER=1 ')).toEqual(['BED=', 'MATERIAL=']);
    expect(labels('START_PRINT extruder=1 bed=60 M')).toEqual(['MATERIAL=']);
  });

  it('работает для расширенных команд из docs, а не только макросов', () => {
    expect(labels('SET_PIN ')).toEqual(['PIN=', 'VALUE=', 'TEMPLATE=', 'CYCLE_TIME=']);
    expect(labels('SET_PIN PIN=x CYCLE')).toEqual(['CYCLE_TIME=']);
  });

  it('буквенные параметры стандартных команд не предлагаются', () => {
    expect(labels('G1 ')).toEqual([]);
    expect(labels('G1 X10 F')).toEqual([]);
  });

  it('внутри строки в кавычках — тишина', () => {
    expect(labels('RESPOND MSG="hello ')).toEqual([]);
    expect(labels('RESPOND MSG="hello" ')).toEqual(['TYPE=', 'PREFIX=']);
  });

  it('режим вывода не ломается на лишних пробелах между токенами', () => {
    expect(labels('START_PRINT   EXTRUDER=1    ')).toEqual(['BED=', 'MATERIAL=']);
  });
});

describe('значения', () => {
  it('перечисления из docs после «=»', () => {
    const r = suggestForLine(catalog, 'SET_DUAL_CARRIAGE CARRIAGE=1 MODE=');
    expect(r.items.map((i) => i.label)).toEqual(['PRIMARY', 'COPY', 'MIRROR', 'INACTIVE']);
    expect(r.items.every((i) => i.kind === 'value')).toBe(true);
    expect(r.passive).toBe(true);
    expect(r.replaceStart).toBe('SET_DUAL_CARRIAGE CARRIAGE=1 MODE='.length);
  });

  it('фильтр по префиксу значения; точное совпадение не предлагается', () => {
    expect(labels('SET_DUAL_CARRIAGE CARRIAGE=1 MODE=m')).toEqual(['MIRROR']);
    expect(labels('SET_DUAL_CARRIAGE CARRIAGE=1 MODE=COPY')).toEqual([]);
  });

  it('флаги 0/1', () => {
    expect(labels('SET_FILAMENT_SENSOR SENSOR=x ENABLE=')).toEqual(['0', '1']);
  });

  it('перечисление из нескольких usage: RESPOND TYPE=', () => {
    expect(labels('RESPOND TYPE=e')).toEqual(['echo', 'echo_no_space', 'error']);
  });

  it('у параметров без перечислений значения не предлагаются', () => {
    expect(labels('START_PRINT BED=')).toEqual([]);
    expect(labels('START_PRINT NOPE=')).toEqual([]);
  });
});

describe('completionTokenStart', () => {
  it('начало токена под кареткой', () => {
    expect(completionTokenStart('')).toBe(0);
    expect(completionTokenStart('  G2')).toBe(2);
    expect(completionTokenStart('START_PRINT ')).toBe(12);
    expect(completionTokenStart('START_PRINT BE')).toBe(12);
    expect(completionTokenStart('SET_PIN PIN=led VAL')).toBe(16);
  });

  it('после «=» — значение; внутри кавычек — null', () => {
    expect(completionTokenStart('MODE=PRI')).toBe(5);
    expect(completionTokenStart('RESPOND MSG="he')).toBeNull();
    expect(completionTokenStart('RESPOND MSG="hello" ')).toBe(20);
  });
});

describe('имена объектов принтера', () => {
  const ndocs = parseGcodeDocs(
    [
      '## Additional Commands',
      '### [fan_generic]',
      '#### SET_FAN_SPEED',
      '`SET_FAN_SPEED FAN=config_name SPEED=<speed>`: Sets the fan speed.',
      '### [heaters]',
      '#### SET_HEATER_TEMPERATURE',
      '`SET_HEATER_TEMPERATURE HEATER=<heater_name> [TARGET=<target_temperature>]`: Sets the heater.',
      '### [resonance_tester]',
      '#### TEST_RESONANCES',
      '`TEST_RESONANCES AXIS=<axis> [NAME=<name>] [CHIPS=<chip_name>]`: Runs the resonance test.',
      '### [gcode_macro]',
      '#### SET_GCODE_VARIABLE',
      '`SET_GCODE_VARIABLE MACRO=<macro_name> VARIABLE=<name> VALUE=<value>`: Changes a variable.',
    ].join('\n'),
  );
  const ncatalog = buildCatalog({
    help: {
      SET_FAN_SPEED: 'x',
      SET_HEATER_TEMPERATURE: 'x',
      TEST_RESONANCES: 'x',
      SET_GCODE_VARIABLE: 'x',
    },
    docs: ndocs,
    macros: [],
  });
  const index = buildObjectIndex({
    sections: [
      'fan_generic cooling',
      'fan_generic Case Fan',
      'fan_generic aux',
      'extruder',
      'heater_bed',
      'heater_generic chamber heater',
      'adxl345 x',
      'adxl345 y',
      'adxl345 z',
      'gcode_macro START_PRINT',
    ],
    macros: [{ name: 'START_PRINT', description: '', params: [], variables: ['count', 'state'] }],
  });
  const opts = { names: makeNameResolver(index) };
  const labelsN = (line: string, o = opts) => suggestForLine(ncatalog, line, o).items.map((i) => i.label);

  it('после «=» предлагаются имена из конфигурации, passive и replaceStart', () => {
    const r = suggestForLine(ncatalog, 'SET_FAN_SPEED FAN=', opts);
    expect(r.items.map((i) => i.label)).toEqual(['aux', 'Case Fan', 'cooling']);
    expect(r.items.every((i) => i.kind === 'value' && i.description === 'fan_generic')).toBe(true);
    expect(r.passive).toBe(true);
    expect(r.replaceStart).toBe('SET_FAN_SPEED FAN='.length);
  });

  it('фильтр по префиксу без учёта регистра; точное совпадение не предлагается', () => {
    expect(labelsN('SET_FAN_SPEED FAN=co')).toEqual(['cooling']);
    expect(labelsN('SET_FAN_SPEED FAN=COOLING')).toEqual([]);
    expect(suggestForLine(ncatalog, 'SET_FAN_SPEED FAN=co', opts).passive).toBe(false);
  });

  it('имя с пробелом подставляется в кавычках, в списке показано без них', () => {
    const item = suggestForLine(ncatalog, 'SET_FAN_SPEED FAN=Ca', opts).items[0]!;
    expect(item.label).toBe('Case Fan');
    expect(item.insert).toBe('"Case Fan"');
    expect(suggestForLine(ncatalog, 'SET_HEATER_TEMPERATURE HEATER=cha', opts).items[0]!.insert).toBe(
      '"chamber heater"',
    );
  });

  it('разные команды с одним и тем же config_name получают разные наборы', () => {
    expect(labelsN('SET_HEATER_TEMPERATURE HEATER=')).toEqual([
      'chamber heater',
      'extruder',
      'heater_bed',
    ]);
  });

  it('список через запятую: подбор по последнему элементу без уже выбранных', () => {
    const r = suggestForLine(ncatalog, 'TEST_RESONANCES AXIS=X CHIPS=x,', opts);
    expect(r.items.map((i) => i.label)).toEqual(['y', 'z']);
    expect(r.items.map((i) => i.insert)).toEqual(['y', 'z']); // без кавычек внутри списка
    expect(r.replaceStart).toBe('TEST_RESONANCES AXIS=X CHIPS=x,'.length);
    expect(r.passive).toBe(true);
    expect(labelsN('TEST_RESONANCES AXIS=X CHIPS=x,z,')).toEqual(['y']);
    expect(labelsN('TEST_RESONANCES AXIS=X CHIPS=x,y')).toEqual([]); // y набран целиком
    expect(labelsN('TEST_RESONANCES AXIS=X CHIPS=')).toEqual(['x', 'y', 'z']);
  });

  it('VARIABLE берёт переменные макроса из MACRO= на этой же строке', () => {
    expect(labelsN('SET_GCODE_VARIABLE MACRO=START_PRINT VARIABLE=')).toEqual(['count', 'state']);
    expect(labelsN('SET_GCODE_VARIABLE MACRO="start_print" VARIABLE=s')).toEqual(['state']);
    expect(labelsN('SET_GCODE_VARIABLE VARIABLE=')).toEqual([]);
    expect(labelsN('SET_GCODE_VARIABLE MACRO=')).toEqual(['START_PRINT']);
  });

  it('параметры без правила (NAME=) значений не получают, без resolver — тоже', () => {
    expect(labelsN('TEST_RESONANCES AXIS=X NAME=')).toEqual([]);
    expect(labelsN('SET_FAN_SPEED FAN=', {} as typeof opts)).toEqual([]);
  });

  it('перечисления из docs важнее имён', () => {
    // у ENABLE=[0|1] нет правила имён, но choices работают как раньше
    expect(labels('SET_FILAMENT_SENSOR SENSOR=x ENABLE=')).toEqual(['0', '1']);
  });
});

describe('completionTokenStart: списки', () => {
  it('позиция после последней запятой значения', () => {
    expect(completionTokenStart('TEST_RESONANCES CHIPS=x,y')).toBe('TEST_RESONANCES CHIPS=x,'.length);
    expect(completionTokenStart('TEST_RESONANCES CHIPS=x')).toBe('TEST_RESONANCES CHIPS='.length);
    expect(completionTokenStart('X CHIPS=a,')).toBe('X CHIPS=a,'.length);
  });
});
