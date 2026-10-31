import { describe, expect, it } from 'vitest';

import { macroParamNamesAt, scanLocalMacros } from '../local-macros';

const CFG = [
  '[printer]',
  'kinematics: cartesian',
  '',
  '[gcode_macro START_PRINT]',
  'description: Start the print',
  'variable_x: 1',
  'gcode:',
  '    {% set bed = params.BED|default(60)|float %}',
  '    M140 S{bed}',
  '    # comment with params.IGNORED',
  '    G1 X{params.X|int} E{params.EXTRUDER}',
  '',
  '# a comment in the first column does not end the value',
  '    M104 S{params.TEMP|default(200)|int}',
  '',
  '[gcode_macro  clean_nozzle ]',
  'gcode:',
  '    G28',
  '',
  '[stepper_x]',
  'step_pin: PF13',
].join('\n');

describe('scanLocalMacros', () => {
  const macros = scanLocalMacros(CFG);

  it('находит макросы с описанием и параметрами из тела gcode', () => {
    expect(macros.map((m) => m.name)).toEqual(['START_PRINT', 'clean_nozzle']);
    expect(macros[0]!.description).toBe('Start the print');
    expect(macros[0]!.params.map((p) => [p.name, p.type, p.def, p.required])).toEqual([
      ['BED', 'float', '60', false],
      ['X', 'int', null, true],
      ['EXTRUDER', 'string', null, true],
      ['TEMP', 'int', '200', false],
    ]);
  });

  it('макрос без параметров и без описания', () => {
    expect(macros[1]).toMatchObject({ name: 'clean_nozzle', description: '', params: [] });
  });

  it('переменные variable_* без префикса', () => {
    expect(macros[0]!.variables).toEqual(['x']);
    expect(macros[1]!.variables).toEqual([]);
    const two = scanLocalMacros(
      '[gcode_macro A]\nVariable_Count: 0\nvariable_state: idle\nvariable_: 1\ngcode: M117\n',
    );
    expect(two[0]!.variables).toEqual(['count', 'state']);
  });

  it('gcode в одну строку и CRLF', () => {
    const one = scanLocalMacros('[gcode_macro A]\r\ngcode: M117 {params.MSG|default("x")}\r\n');
    expect(one).toHaveLength(1);
    expect(one[0]!.params.map((p) => p.name)).toEqual(['MSG']);
  });

  it('не секции gcode_macro игнорируются', () => {
    expect(scanLocalMacros('[stepper_x]\ngcode: {params.X}\n')).toEqual([]);
    expect(scanLocalMacros('')).toEqual([]);
  });
});

describe('macroParamNamesAt', () => {
  it('имена параметров макроса, в теле которого каретка', () => {
    const at = CFG.indexOf('M140');
    expect(macroParamNamesAt(CFG, at)).toEqual(['BED', 'X', 'EXTRUDER', 'TEMP']);
    expect(macroParamNamesAt(CFG, CFG.indexOf('G28'))).toEqual([]);
  });

  it('на строке заголовка тоже внутри макроса, вне макросов — null', () => {
    expect(macroParamNamesAt(CFG, CFG.indexOf('[gcode_macro START'))).toEqual(['BED', 'X', 'EXTRUDER', 'TEMP']);
    expect(macroParamNamesAt(CFG, CFG.indexOf('kinematics'))).toBeNull();
    expect(macroParamNamesAt(CFG, CFG.indexOf('step_pin'))).toBeNull();
  });
});
