import { describe, expect, it } from 'vitest';

import {
  buildObjectIndex,
  jinjaObjectNames,
  macroVariables,
  mergeObjectIndex,
  printerRef,
  quoteValue,
  resolveNames,
  scanSectionNames,
} from '../object-names';

const SECTIONS = [
  'printer',
  'mcu',
  'mcu EBB',
  'stepper_x',
  'stepper_y',
  'stepper_z',
  'stepper_z1',
  'extruder',
  'extruder1',
  'extruder_stepper belt',
  'heater_bed',
  'heater_generic chamber',
  'heater_generic Dryer Box',
  'temperature_sensor raspberry_pi',
  'temperature_fan exhaust',
  'temperature_probe eddy',
  'fan',
  'fan_generic cooling',
  'fan_generic aux',
  'output_pin led',
  'pwm_tool laser',
  'servo gate',
  'neopixel status',
  'led bar',
  'adxl345',
  'adxl345 bed',
  'lis2dw side',
  'angle a_sensor',
  'filament_switch_sensor runout',
  'filament_motion_sensor encoder',
  'manual_stepper belt_y',
  'tmc2209 stepper_x',
  'tmc2209 extruder',
  'tmc5160 stepper_y',
  'delayed_gcode clear_display',
  'display_template fan_speed',
  'gcode_macro START_PRINT',
  'gcode_macro clean',
  'bed_mesh',
  'bed_mesh default',
  'bed_mesh adaptive',
  'skew_correction',
  'skew_correction cube',
  'load_cell scale',
  'ad5206 pots',
];

const index = buildObjectIndex({
  sections: SECTIONS,
  macros: [
    { name: 'START_PRINT', description: '', params: [], variables: ['bed_temp', 'primed'] },
    { name: 'clean', description: '', params: [], variables: [] },
  ],
});

const names = (command: string, param: string, values: Record<string, string> = {}) =>
  resolveNames(index, command, param, values)?.names.map((n) => n.value);

describe('resolveNames: правила команда + параметр', () => {
  it('FAN → fan_generic (только с именем)', () => {
    expect(names('SET_FAN_SPEED', 'FAN')).toEqual(['aux', 'cooling']);
  });

  it('HEATER → экструдеры, стол и heater_generic', () => {
    expect(names('SET_HEATER_TEMPERATURE', 'HEATER')).toEqual([
      'chamber',
      'Dryer Box',
      'extruder',
      'extruder1',
      'heater_bed',
    ].sort((a, b) => a.localeCompare(b)));
    expect(names('PID_CALIBRATE', 'HEATER')).toEqual(names('SET_HEATER_TEMPERATURE', 'HEATER'));
  });

  it('SENSOR: TEMPERATURE_WAIT — температуры, FILAMENT_SENSOR — датчики филамента', () => {
    const t = names('TEMPERATURE_WAIT', 'SENSOR')!;
    expect(t).toEqual(expect.arrayContaining(['extruder', 'heater_bed', 'raspberry_pi', 'exhaust', 'eddy', 'chamber']));
    expect(t).not.toContain('runout');
    expect(names('QUERY_FILAMENT_SENSOR', 'SENSOR')).toEqual(['encoder', 'runout']);
    expect(names('SET_FILAMENT_SENSOR', 'SENSOR')).toEqual(['encoder', 'runout']);
  });

  it('EXTRUDER и MOTION_QUEUE', () => {
    expect(names('ACTIVATE_EXTRUDER', 'EXTRUDER')).toEqual(['belt', 'extruder', 'extruder1']);
    expect(names('SYNC_EXTRUDER_MOTION', 'MOTION_QUEUE')).toEqual(['extruder', 'extruder1']);
  });

  it('STEPPER: общий, MANUAL_STEPPER и TMC-команды', () => {
    expect(names('FORCE_MOVE', 'STEPPER')).toEqual([
      'extruder',
      'extruder1',
      'stepper_x',
      'stepper_y',
      'stepper_z',
      'stepper_z1',
    ]);
    expect(names('MANUAL_STEPPER', 'STEPPER')).toEqual(['belt_y']);
    // имена шаговиков берутся из секций драйверов
    for (const c of ['DUMP_TMC', 'INIT_TMC', 'SET_TMC_CURRENT', 'SET_TMC_FIELD']) {
      expect(names(c, 'STEPPER')).toEqual(['extruder', 'stepper_x', 'stepper_y']);
    }
  });

  it('PIN, SERVO, LED, TEMPLATE, ID, LOAD_CELL, DIGIPOT, PROBE', () => {
    expect(names('SET_PIN', 'PIN')).toEqual(['laser', 'led']);
    expect(names('SET_SERVO', 'SERVO')).toEqual(['gate']);
    expect(names('SET_LED', 'LED')).toEqual(['bar', 'status']);
    expect(names('SET_FAN_SPEED', 'TEMPLATE')).toEqual(['fan_speed']);
    expect(names('UPDATE_DELAYED_GCODE', 'ID')).toEqual(['clear_display']);
    expect(names('LOAD_CELL_TARE', 'LOAD_CELL')).toEqual(['scale']);
    expect(names('SET_DIGIPOT', 'DIGIPOT')).toEqual(['pots']);
    expect(names('TEMPERATURE_PROBE_CALIBRATE', 'PROBE')).toEqual(['eddy']);
  });

  it('CHIP: акселерометры, у ANGLE_* — датчики угла; безымянная секция называется по типу', () => {
    expect(names('ACCELEROMETER_QUERY', 'CHIP')).toEqual(['adxl345', 'bed', 'side']);
    expect(names('ANGLE_CALIBRATE', 'CHIP')).toEqual(['a_sensor']);
  });

  it('CHIPS — список через запятую', () => {
    const r = resolveNames(index, 'TEST_RESONANCES', 'CHIPS')!;
    expect(r.separator).toBe(',');
    expect(r.names.map((n) => n.value)).toEqual(['adxl345', 'bed', 'side']);
  });

  it('профили: только секции с именем, SAVE без подсказок', () => {
    expect(names('BED_MESH_PROFILE', 'LOAD')).toEqual(['adaptive', 'default']);
    expect(names('BED_MESH_PROFILE', 'REMOVE')).toEqual(['adaptive', 'default']);
    expect(names('BED_MESH_CALIBRATE', 'PROFILE')).toEqual(['adaptive', 'default']);
    expect(names('SKEW_PROFILE', 'LOAD')).toEqual(['cube']);
    expect(resolveNames(index, 'BED_MESH_PROFILE', 'SAVE')).toBeNull();
  });

  it('SET_GCODE_VARIABLE: MACRO — имена макросов, VARIABLE — переменные выбранного макроса', () => {
    expect(names('SET_GCODE_VARIABLE', 'MACRO')).toEqual(['clean', 'START_PRINT']);
    expect(names('SET_GCODE_VARIABLE', 'VARIABLE', { MACRO: 'start_print' })).toEqual([
      'bed_temp',
      'primed',
    ]);
    expect(names('SET_GCODE_VARIABLE', 'VARIABLE', { MACRO: 'clean' })).toEqual([]);
    expect(names('SET_GCODE_VARIABLE', 'VARIABLE')).toEqual([]);
  });

  it('регистр команды и параметра не важен; неизвестные пары → null', () => {
    expect(names('set_fan_speed', 'fan')).toEqual(['aux', 'cooling']);
    expect(resolveNames(index, 'SAVE_GCODE_STATE', 'NAME')).toBeNull();
    expect(resolveNames(index, 'BED_MESH_OUTPUT', 'PGP')).toBeNull();
    expect(resolveNames(index, 'DUMP_TMC', 'REGISTER')).toBeNull();
  });

  it('detail — тип секции', () => {
    const r = resolveNames(index, 'SET_HEATER_TEMPERATURE', 'HEATER')!;
    expect(r.names.find((n) => n.value === 'chamber')?.detail).toBe('heater_generic');
    expect(r.names.find((n) => n.value === 'extruder')?.detail).toBe('extruder');
  });

  it('пустой конфиг даёт пустой список, а не null', () => {
    const empty = buildObjectIndex({ sections: [], macros: [] });
    expect(resolveNames(empty, 'SET_FAN_SPEED', 'FAN')).toEqual({ names: [] });
  });
});

describe('индекс', () => {
  it('регистр секций не теряется, дубли без учёта регистра убираются, пробелы схлопываются', () => {
    const i = buildObjectIndex({
      sections: ['fan_generic  Cooling', 'FAN_GENERIC cooling', 'heater_bed'],
      macros: [],
    });
    expect(i.entries.map((e) => e.section)).toEqual(['fan_generic Cooling', 'heater_bed']);
  });

  it('объекты для jinja: printer.objects.list, иначе секции', () => {
    expect(jinjaObjectNames(buildObjectIndex({ sections: ['b', 'a'], macros: [] }))).toEqual(['a', 'b']);
    expect(
      jinjaObjectNames(
        buildObjectIndex({ sections: ['x'], macros: [], objects: ['toolhead', 'gcode_move'] }),
      ),
    ).toEqual(['gcode_move', 'toolhead']);
  });

  it('mergeObjectIndex: секции и макросы файла дополняют данные принтера', () => {
    const merged = mergeObjectIndex(index, {
      sections: ['fan_generic test_fan', 'gcode_macro START_PRINT'],
      macros: [{ name: 'start_print', description: '', params: [], variables: ['local_var'] }],
    });
    expect(
      resolveNames(merged, 'SET_FAN_SPEED', 'FAN')?.names.map((n) => n.value),
    ).toEqual(['aux', 'cooling', 'test_fan']);
    // переменные макроса из файла заменяют принтерные
    expect(macroVariables(merged, 'START_PRINT')).toEqual(['local_var']);
    // базовый индекс не мутируется
    expect(macroVariables(index, 'START_PRINT')).toEqual(['bed_temp', 'primed']);
    expect(mergeObjectIndex(index, { sections: [], macros: [] })).toBe(index);
  });
});

describe('вспомогательные', () => {
  it('scanSectionNames', () => {
    expect(
      scanSectionNames('[printer]\nfoo: [1]\n  [indented]\n[fan_generic  cooling]\n# [c]\n[a]'),
    ).toEqual(['printer', 'fan_generic cooling', 'a']);
  });

  it('quoteValue: пробелы → кавычки', () => {
    expect(quoteValue('cooling')).toBe('cooling');
    expect(quoteValue('Dryer Box')).toBe('"Dryer Box"');
  });

  it('printerRef: идентификатор или ["…"]', () => {
    expect(printerRef('extruder')).toBe('printer.extruder');
    expect(printerRef('fan_generic cooling')).toBe('printer["fan_generic cooling"]');
  });
});
