import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { parseGcodeDocs, parseUsage } from '../gcode-docs';
import type { CommandDoc, ParamInfo } from '../types';

const SAMPLE = readFileSync(resolve(__dirname, 'fixtures/g-codes.sample.md'), 'utf8');
const docs = parseGcodeDocs(SAMPLE);
const cmd = (name: string): CommandDoc => {
  const c = docs.commands.get(name);
  if (!c) throw new Error(`no ${name}`);
  return c;
};
const param = (c: CommandDoc, name: string): ParamInfo => {
  const p = c.params.find((x) => x.name === name);
  if (!p) throw new Error(`no ${c.name}.${name}`);
  return p;
};

describe('parseUsage', () => {
  it('обязательные и необязательные параметры', () => {
    const { name, params } = parseUsage('ACCELEROMETER_DEBUG_READ [CHIP=<config_name>] REG=<register>');
    expect(name).toBe('ACCELEROMETER_DEBUG_READ');
    expect(params.map((p) => [p.name, p.optional])).toEqual([
      ['CHIP', true],
      ['REG', false],
    ]);
    expect(params[0]).toMatchObject({ valueKind: 'name', hint: 'config_name', style: 'named' });
  });

  it('перечисления: [0|1], <X|Y>, a|b, вложенные скобки', () => {
    const p = (u: string, n: string) => parseUsage(u).params.find((x) => x.name === n);
    expect(p('SET_FILAMENT_SENSOR SENSOR=<n> ENABLE=[0|1]', 'ENABLE')).toMatchObject({
      choices: ['0', '1'],
      valueKind: 'flag',
      required: true,
    });
    expect(p('X [AXIS=<X|Y>]', 'AXIS')?.choices).toEqual(['X', 'Y']);
    expect(p('X [SAMPLES_RESULT=median|average]', 'SAMPLES_RESULT')?.choices).toEqual([
      'median',
      'average',
    ]);
    expect(
      p('SET_DUAL_CARRIAGE CARRIAGE=<c> [MODE=[PRIMARY|COPY|MIRROR|INACTIVE]]', 'MODE'),
    ).toMatchObject({ choices: ['PRIMARY', 'COPY', 'MIRROR', 'INACTIVE'], optional: true });
    expect(p('BED_MESH_OUTPUT PGP=[<0:1>]', 'PGP')?.choices).toEqual(['0', '1']);
  });

  it('не падает на опечатках в скобках и сохраняет все параметры', () => {
    const { params } = parseUsage('BED_MESH_OFFSET [X=<value>] [Y=<value>] [ZFADE=<value]');
    expect(params.map((p) => p.name)).toEqual(['X', 'Y', 'ZFADE']);
    expect(params[2]).toMatchObject({ optional: true, valueKind: 'number' });

    const ex = parseUsage('EXCLUDE_OBJECT_DEFINE [NAME=object_name [CENTER=X,Y] [POLYGON=[[x,y],...]] [RESET=1] [JSON=1]');
    expect(ex.params.map((p) => p.name)).toEqual(['NAME', 'CENTER', 'POLYGON', 'RESET', 'JSON']);
    expect(ex.params.every((p) => p.optional)).toBe(true);
  });

  it('подстановочные имена <param_x>= не считаются параметрами', () => {
    const { params } = parseUsage(
      'SET_PIN PIN=config_name TEMPLATE=<template_name> [<param_x>=<literal>]',
    );
    expect(params.map((p) => p.name)).toEqual(['PIN', 'TEMPLATE']);
  });

  it('альтернативы X=<pos>|X_ADJUST=<adjust> — оба необязательные', () => {
    const { params } = parseUsage(
      'SET_GCODE_OFFSET [X=<pos>|X_ADJUST=<adjust>] [MOVE=1 [MOVE_SPEED=<speed>]]',
    );
    expect(params.map((p) => [p.name, p.optional])).toEqual([
      ['X', true],
      ['X_ADJUST', true],
      ['MOVE', true],
      ['MOVE_SPEED', true],
    ]);
  });

  it('значения в кавычках и с пробелом внутри <>', () => {
    const r = parseUsage('RESPOND MSG="<message>"').params[0];
    expect(r).toMatchObject({ name: 'MSG', hint: 'message', required: true });
    expect(parseUsage('X [PROBE=<probe name>] [T=<v>]').params.map((p) => p.name)).toEqual([
      'PROBE',
      'T',
    ]);
  });

  it('буквенные параметры G/M-команд', () => {
    const { name, params } = parseUsage('G1 [X<pos>] [Y<pos>] [Z<pos>] [E<pos>] [F<speed>]');
    expect(name).toBe('G1');
    expect(params.map((p) => [p.name, p.style, p.optional, p.valueKind])).toEqual([
      ['X', 'letter', true, 'number'],
      ['Y', 'letter', true, 'number'],
      ['Z', 'letter', true, 'number'],
      ['E', 'letter', true, 'number'],
      ['F', 'letter', true, 'number'],
    ]);
    expect(parseUsage('M109 [T<index>] S<temperature>').params[1]).toMatchObject({
      name: 'S',
      optional: false,
    });
  });
});

describe('parseGcodeDocs: стандартные команды', () => {
  it('G0 из «Move (G0 or G1)», пары M18/M84 и G90/G91', () => {
    for (const n of ['G0', 'G1', 'G4', 'G28', 'G90', 'G91', 'M18', 'M84', 'M82', 'M83', 'M104', 'M115']) {
      expect(docs.commands.get(n)?.kind, n).toBe('standard');
    }
    expect(cmd('G0').params.map((p) => p.name)).toEqual(['X', 'Y', 'Z', 'E', 'F']);
    expect(cmd('G1').description).toMatch(/^Move/);
  });

  it('несколько usage одной команды объединяются (M204: S | P T)', () => {
    expect(cmd('M204').params.map((p) => p.name).sort()).toEqual(['P', 'S', 'T']);
  });

  it('вложенные примечания попадают в details', () => {
    expect(cmd('M83').details).toMatch(/forces extrusions to use relative coordinates/);
  });

  it('стандартная команда из модульного раздела: M118 в [respond]', () => {
    expect(cmd('M118')).toMatchObject({ kind: 'standard', module: 'respond' });
  });
});

describe('parseGcodeDocs: расширенные команды', () => {
  it('модуль, описание и параметры', () => {
    const c = cmd('BED_MESH_CALIBRATE');
    expect(c).toMatchObject({ kind: 'extended', module: 'bed_mesh' });
    expect(c.description).toMatch(/probes the bed/);
    expect(c.params.map((p) => p.name)).toEqual([
      'PROFILE',
      'METHOD',
      'HORIZONTAL_MOVE_Z',
      'ADAPTIVE',
      'ADAPTIVE_MARGIN',
    ]);
    expect(param(c, 'PROFILE').optional).toBe(true);
  });

  it('usage на нескольких строках', () => {
    expect(cmd('SET_PRESSURE_ADVANCE').params.map((p) => p.name)).toEqual([
      'EXTRUDER',
      'ADVANCE',
      'SMOOTH_TIME',
    ]);
    expect(cmd('ACCELEROMETER_DEBUG_WRITE').params.map((p) => p.name)).toEqual([
      'CHIP',
      'REG',
      'VAL',
    ]);
  });

  it('два usage: SET_FAN_SPEED — FAN обязателен, SPEED и TEMPLATE нет', () => {
    const c = cmd('SET_FAN_SPEED');
    expect(param(c, 'FAN').required).toBe(true);
    expect(param(c, 'SPEED').required).toBe(false);
    expect(param(c, 'TEMPLATE').required).toBe(false);
    expect(c.params.map((p) => p.name)).toEqual(['FAN', 'SPEED', 'TEMPLATE']);
    expect(c.usages).toHaveLength(2);
  });

  it('RESPOND: usage в списке, TYPE — перечисление из нескольких usage', () => {
    const c = cmd('RESPOND');
    expect(c.usages.length).toBeGreaterThanOrEqual(5);
    expect(param(c, 'TYPE').choices).toEqual(['echo', 'echo_no_space', 'command', 'error']);
    expect(param(c, 'MSG').required).toBe(true);
    expect(param(c, 'PREFIX')).toBeDefined();
  });

  it('заголовки в обратных кавычках и с двоеточием', () => {
    expect(docs.commands.has('EXCLUDE_OBJECT')).toBe(true);
    expect(docs.commands.has('EXCLUDE_OBJECT_START')).toBe(true);
    expect(docs.commands.has('TEMPERATURE_PROBE_COMPLETE')).toBe(true);
  });

  it('команда с заголовком уровня ### (опечатка в документе)', () => {
    const c = cmd('TEMPERATURE_PROBE_ENABLE');
    expect(c.params.map((p) => p.name)).toEqual(['ENABLE']);
    expect(param(c, 'ENABLE').choices).toEqual(['0', '1']);
  });

  it('описания параметров из списков в тексте команды', () => {
    expect(param(cmd('EXCLUDE_OBJECT_DEFINE'), 'NAME').description).toMatch(/required/i);
    expect(param(cmd('EXCLUDE_OBJECT_DEFINE'), 'CENTER').description).toMatch(/coordinate/i);
  });

  it('CRLF не меняет результат', () => {
    const crlf = parseGcodeDocs(SAMPLE.replace(/\n/g, '\r\n'));
    expect([...crlf.commands.keys()]).toEqual([...docs.commands.keys()]);
    expect(crlf.commands.get('SET_PIN')?.params).toEqual(docs.commands.get('SET_PIN')?.params);
  });
});

// Настоящий справочник Klipper из корня проекта (временная копия пользователя).
// Без файла тест пропускается — фикстура покрывает те же правила.
const REAL = resolve(__dirname, '../../../../G-Codes.md');

describe.skipIf(!existsSync(REAL))('настоящий G-Codes.md', () => {
  const real = parseGcodeDocs(existsSync(REAL) ? readFileSync(REAL, 'utf8') : '');
  const ext = [...real.commands.values()].filter((c) => c.kind === 'extended');

  it('находит более 120 расширенных команд, у каждой есть описание', () => {
    expect(ext.length).toBeGreaterThan(120);
    expect(ext.filter((c) => !c.description).map((c) => c.name)).toEqual([]);
  });

  it('у каждой расширенной команды есть usage с её именем, модуль известен', () => {
    expect(ext.filter((c) => c.usages.length === 0).map((c) => c.name)).toEqual([]);
    expect(ext.filter((c) => !c.module).map((c) => c.name)).toEqual([]);
  });

  it('все параметры именованные и в верхнем регистре, без подстановочных имён', () => {
    for (const c of ext) {
      for (const p of c.params) {
        expect(p.name, `${c.name}.${p.name}`).toMatch(/^[A-Z_][A-Z0-9_]*$/);
        expect(p.style).toBe('named');
      }
    }
  });

  it('ключевые команды и значения', () => {
    const g = (n: string) => real.commands.get(n);
    expect(g('SET_DUAL_CARRIAGE')?.params.find((p) => p.name === 'MODE')?.choices).toEqual([
      'PRIMARY',
      'COPY',
      'MIRROR',
      'INACTIVE',
    ]);
    expect(g('SET_FILAMENT_SENSOR')?.params.find((p) => p.name === 'ENABLE')?.choices).toEqual([
      '0',
      '1',
    ]);
    expect(g('G28')?.kind).toBe('standard');
    expect(g('M104')?.params.map((p) => p.name)).toEqual(['T', 'S']);
    for (const n of ['SAVE_CONFIG', 'RESTART', 'FIRMWARE_RESTART', 'STATUS', 'SET_HEATER_TEMPERATURE', 'PROBE', 'DUMP_TMC']) {
      expect(real.commands.has(n), n).toBe(true);
    }
  });
});
