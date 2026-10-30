import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { buildCatalog, letterSignature, mergeLocalMacros, namedParams, paramTypeLabel } from '../catalog';
import { parseGcodeDocs } from '../gcode-docs';
import type { MacroSource } from '../local-macros';

const docs = parseGcodeDocs(
  readFileSync(resolve(__dirname, 'fixtures/g-codes.sample.md'), 'utf8'),
);

const macro = (name: string, params: MacroSource['params'] = [], description = ''): MacroSource => ({
  name,
  description,
  params,
});

describe('buildCatalog', () => {
  it('без docs и help: запасная таблица стандартных команд без описаний', () => {
    const c = buildCatalog({ help: null, docs: null, macros: [] });
    expect(c.get('G1')?.kind).toBe('standard');
    expect(c.get('G1')?.description).toBeUndefined();
    expect(letterSignature(c.get('G28')!)).toBe('X Y Z');
    expect(c.has('SET_PIN')).toBe(false);
  });

  it('стандартные команды получают описание и параметры из docs', () => {
    const c = buildCatalog({ help: {}, docs, macros: [] });
    expect(c.get('G1')?.description).toMatch(/^Move/);
    expect(c.get('M118')).toMatchObject({ kind: 'standard', module: 'respond' });
  });

  it('расширенные команды доступны только если есть в help', () => {
    const c = buildCatalog({ help: { SET_PIN: 'Set the value of an output pin' }, docs, macros: [] });
    expect(c.get('SET_PIN')).toMatchObject({ kind: 'extended', module: 'output_pin' });
    expect(namedParams(c.get('SET_PIN')!).map((p) => p.name)).toEqual(['PIN', 'VALUE', 'TEMPLATE', 'CYCLE_TIME']);
    expect(c.has('BED_MESH_CALIBRATE')).toBe(false); // модуль не загружен на принтере
  });

  it('help ещё не загружен — показываем всё из docs', () => {
    const c = buildCatalog({ help: null, docs, macros: [] });
    expect(c.has('BED_MESH_CALIBRATE')).toBe(true);
  });

  it('команда из help без записи в docs остаётся с описанием из help', () => {
    const c = buildCatalog({ help: { KAMP_THING: 'Adaptive thing' }, docs, macros: [] });
    expect(c.get('KAMP_THING')).toMatchObject({
      kind: 'extended',
      description: 'Adaptive thing',
      params: [],
    });
  });

  it('макросы: имя в написании help, описание, типы параметров, дефолтное описание скрыто', () => {
    const c = buildCatalog({
      help: { START_PRINT: 'Start my print', CLEAN: 'G-Code macro' },
      docs,
      macros: [
        macro('start_print', [{ name: 'BED', type: 'float', def: '60', required: false }], 'Start my print'),
        macro('clean', [], 'G-Code macro'),
      ],
    });
    const m = c.get('START_PRINT')!;
    expect(m).toMatchObject({ name: 'START_PRINT', kind: 'macro', description: 'Start my print' });
    expect(m.params[0]).toMatchObject({
      name: 'BED',
      style: 'named',
      valueKind: 'number',
      type: 'float',
      def: '60',
      optional: true,
    });
    expect(c.get('CLEAN')).toMatchObject({ kind: 'macro', description: undefined });
  });

  it('макрос перекрывает одноимённую команду', () => {
    const c = buildCatalog({
      help: { SET_PIN: 'x' },
      docs,
      macros: [macro('SET_PIN', [{ name: 'A', type: 'string', def: null, required: true }])],
    });
    expect(c.get('SET_PIN')?.kind).toBe('macro');
    expect(c.get('SET_PIN')?.params.map((p) => p.name)).toEqual(['A']);
  });
});

describe('mergeLocalMacros', () => {
  const base = buildCatalog({
    help: { START_PRINT: 'Printer-side' },
    docs: null,
    macros: [macro('START_PRINT', [{ name: 'OLD', type: 'int', def: null, required: true }], 'Printer-side')],
  });

  it('локальные макросы перекрывают данные принтера и не мутируют базу', () => {
    const merged = mergeLocalMacros(base, [
      macro('Start_Print', [{ name: 'NEW', type: 'int', def: '1', required: false }]),
      macro('BRAND_NEW'),
    ]);
    expect(merged.get('START_PRINT')?.name).toBe('START_PRINT');
    expect(merged.get('START_PRINT')?.params.map((p) => p.name)).toEqual(['NEW']);
    expect(merged.get('START_PRINT')?.description).toBe('Printer-side');
    expect(merged.get('BRAND_NEW')?.kind).toBe('macro');
    expect(base.get('START_PRINT')?.params.map((p) => p.name)).toEqual(['OLD']);
    expect(base.has('BRAND_NEW')).toBe(false);
  });

  it('без локальных макросов возвращает тот же каталог', () => {
    expect(mergeLocalMacros(base, [])).toBe(base);
  });
});

describe('paramTypeLabel', () => {
  it('перечисление, тип макроса, подсказка', () => {
    expect(paramTypeLabel({ name: 'A', style: 'named', optional: true, required: false, valueKind: 'flag', choices: ['0', '1'] })).toBe('0|1');
    expect(paramTypeLabel({ name: 'A', style: 'named', optional: true, required: false, valueKind: 'enum', choices: ['a', 'b', 'c', 'd', 'e'] })).toBe('a|b|c|d|…');
    expect(paramTypeLabel({ name: 'A', style: 'named', optional: true, required: false, valueKind: 'number', type: 'float' })).toBe('float');
    expect(paramTypeLabel({ name: 'A', style: 'named', optional: true, required: false, valueKind: 'name', hint: 'config_name' })).toBe('config_name');
  });
});
