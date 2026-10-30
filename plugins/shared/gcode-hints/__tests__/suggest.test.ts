import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { buildCatalog } from '../catalog';
import { parseGcodeDocs } from '../gcode-docs';
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
