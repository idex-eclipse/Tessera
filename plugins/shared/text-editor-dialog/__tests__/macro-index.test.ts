import { describe, expect, it, vi } from 'vitest';
import type { MoonrakerProxyHandle } from '../../../../plugin-sdk/src/types';
import { activeConfigPaths, loadMacroIndex, macroCallAt, macroSectionEdit, scanMacroDefinitions } from '../macro-index';

describe('macro source index', () => {
  it('keeps exact section offsets and locates a literal call in a gcode body', () => {
    const text = '[gcode_macro A]\ngcode:\n  B X=1\n  # B\n\n[gcode_macro B]\ngcode:\n  G28\n';
    const definitions = scanMacroDefinitions(text, 'printer.cfg');
    expect(definitions.map((item) => [item.name, item.firstLine])).toEqual([['A', 1], ['B', 6]]);
    expect(text.slice(definitions[0]!.from, definitions[0]!.to)).toContain('  # B');
    const call = text.indexOf('B X=1');
    expect(macroCallAt(text, call, new Set(['B']))?.name).toBe('B');
    expect(macroCallAt(text, text.indexOf('# B') + 2, new Set(['B']))).toBeNull();
    expect(macroCallAt(text, text.indexOf('G28'), new Set(['B']))).toBeNull();
  });

  it('finds underscore macros in other Klipper gcode sections and after inline Jinja', () => {
    const text = '[homing_override]\ngcode:\n  {% if true %} _HOME_X\n  {% endif %}\n[delayed_gcode foo]\n  gcode:\n    _HOME_X\n';
    const first = text.indexOf('_HOME_X');
    const second = text.lastIndexOf('_HOME_X');
    expect(macroCallAt(text, first + 3, new Set(['_HOME_X']))?.name).toBe('_HOME_X');
    expect(macroCallAt(text, second + 3, new Set(['_HOME_X']))?.from).toBe(second);
    expect(macroCallAt(text, text.indexOf('if true'), new Set(['_HOME_X']))).toBeNull();
    const outside = '[gcode_macro A]\nvariable_x: _HOME_X\ngcode:\n  G28\n';
    expect(macroCallAt(outside, outside.indexOf('_HOME_X'), new Set(['_HOME_X']))).toBeNull();
  });

  it('handles mixed indentation, Jinja branches, comments, and a trailing option in homing_override', () => {
    const text = '[homing_override]\ngcode:\n\tG90\n   \t{% if "z" not in printer.toolhead.homed_axes %}\n\t\t_HOME_Z_DOWN\n\t{% endif %}\n\t#Z_TILT_ADJUST\n    {% if not rawparams or "X" in rawparams %}\n\t\t_HOME_X\n    {% endif %}\naxes: xyz\n';
    const names = new Set(['_HOME_Z_DOWN', '_HOME_X', 'AXES', 'Z_TILT_ADJUST']);
    expect(macroCallAt(text, text.indexOf('_HOME_Z_DOWN') + 4, names)?.name).toBe('_HOME_Z_DOWN');
    expect(macroCallAt(text, text.indexOf('_HOME_X') + 2, names)?.name).toBe('_HOME_X');
    expect(macroCallAt(text, text.indexOf('Z_TILT_ADJUST'), names)).toBeNull();
    expect(macroCallAt(text, text.indexOf('axes: xyz'), names)).toBeNull();
  });

  it('keeps the next header at column zero when a peek ends with auto-indent', () => {
    const source = '[gcode_macro _T000]\ngcode:\n  G28\n\n[gcode_macro _HOME_X]\ngcode:\n  G28 X\n';
    const first = scanMacroDefinitions(source, 'macros.cfg')[0]!;
    const edit = macroSectionEdit(source, first, '[gcode_macro _T000]\ngcode:\n  G28\n  M118 done\n  ');
    expect(edit).not.toBeNull();
    const updated = source.slice(0, edit!.from) + edit!.insert + source.slice(edit!.to);
    expect(updated).toContain('\n[gcode_macro _HOME_X]');
    expect(scanMacroDefinitions(updated, 'macros.cfg').map((item) => item.name)).toEqual(['_T000', '_HOME_X']);
  });

  it('follows nested include masks and leaves unrelated cfg files inactive', () => {
    const files = new Map([
      ['printer.cfg', '[include macros/**/*.cfg]\n'],
      ['macros/a.cfg', '[include nested/b.cfg]\n'],
      ['macros/nested/b.cfg', '[gcode_macro B]\ngcode:\n G28\n'],
      ['spare.cfg', '[gcode_macro B]\ngcode:\n G28\n'],
    ]);
    expect([...activeConfigPaths(files)].sort()).toEqual(['macros/a.cfg', 'macros/nested/b.cfg', 'printer.cfg']);
  });

  it('indexes duplicates with their file paths and uses an unsaved buffer', async () => {
    const sources = new Map([
      ['printer.cfg', '[include macros/*.cfg]\n[gcode_macro A]\ngcode:\n B\n'],
      ['macros/a.cfg', '[gcode_macro B]\ngcode:\n G28\n'],
      ['spare.cfg', '[gcode_macro B]\ngcode:\n G28\n'],
    ]);
    const request = vi.fn(async (_method: string, params: { path: string }) => {
      if (params.path === 'config') return { dirs: [{ dirname: 'macros' }], files: [{ filename: 'printer.cfg' }, { filename: 'spare.cfg' }] };
      return { dirs: [], files: [{ filename: 'a.cfg' }] };
    });
    const target = { request } as unknown as MoonrakerProxyHandle;
    const read = vi.fn(async (ref: { path: string }) => sources.get(ref.path) ?? '');
    const result = await loadMacroIndex(target, read, new Map([['macros/a.cfg', '[gcode_macro B]\ngcode:\n M118 changed\n']]));
    expect(result.definitions.filter((item) => item.name === 'B').map((item) => [item.path, item.active]))
      .toEqual([['spare.cfg', false], ['macros/a.cfg', true]]);
    expect(result.files.get('macros/a.cfg')).toContain('changed');
    expect(read).not.toHaveBeenCalledWith(expect.objectContaining({ path: 'macros/a.cfg' }), target);
  });

  it('surfaces read errors instead of navigating to an incomplete definition', async () => {
    const target = { request: vi.fn(async () => ({
      dirs: [], files: [{ filename: 'printer.cfg' }, { filename: 'broken.cfg' }],
    })) } as unknown as MoonrakerProxyHandle;
    const read = vi.fn(async (ref: { path: string }) => {
      if (ref.path === 'broken.cfg') throw new Error('read failed');
      return '[include broken.cfg]\n';
    });
    await expect(loadMacroIndex(target, read, new Map())).rejects.toThrow('read failed');
  });
});
