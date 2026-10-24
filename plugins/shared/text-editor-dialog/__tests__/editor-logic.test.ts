import { describe, expect, it } from 'vitest';

import { caretLineCol } from '../caret';
import {
  highlightKlipper,
  highlightKlipperLines,
  highlightPlain,
  highlightPlainLines,
  toRenderLines,
} from '../highlight';

const CONFIG = [
  '[stepper_x]',
  'step_pin: PF13',
  'position_max: 300',
  '',
  '[gcode_macro START]',
  'gcode:',
  '    G28',
  '    M104 S{params.T|default(200)}',
  '',
  '[heater_bed]',
  '#*# <---------------------- SAVE_CONFIG ---------------------->',
  '#*# [heater_bed]',
  '#*# control = pid',
  '',
].join('\n');

describe('highlight by lines', () => {
  it('joining the per-line result gives exactly the old whole-text result', () => {
    expect(highlightKlipperLines(CONFIG).join('\n')).toBe(highlightKlipper(CONFIG));
    expect(highlightPlainLines(CONFIG).join('\n')).toBe(highlightPlain(CONFIG));
  });

  it('returns one entry per line, keeping the gcode/save-config state across lines', () => {
    const lines = highlightKlipperLines(CONFIG);
    expect(lines).toHaveLength(CONFIG.split('\n').length);
    // строка внутри gcode-блока подсвечена как gcode, а не как конфиг
    expect(lines[6]).not.toBe(highlightKlipperLines('    G28')[0]);
  });

  it('changing one line changes only that line of the output (cheap DOM patch)', () => {
    const before = highlightKlipperLines(CONFIG);
    const edited = CONFIG.replace('step_pin: PF13', 'step_pin: PF14');
    const after = highlightKlipperLines(edited);

    const changed = after.map((l, i) => (l !== before[i] ? i : -1)).filter((i) => i >= 0);
    expect(changed).toEqual([1]);
  });
});

describe('toRenderLines', () => {
  const render = (text: string) => toRenderLines(highlightPlainLines(text), text).join('');

  it('reproduces the old single-string layer for plain text', () => {
    expect(render('a\nb')).toBe('a\nb');
    expect(render('a')).toBe('a');
  });

  it('adds a zero-width space for the empty last line (empty file or trailing newline)', () => {
    expect(render('')).toBe('​');
    expect(render('a\n')).toBe('a\n​');
    expect(render('a\n\n')).toBe('a\n\n​');
  });

  it('every line except the last ends with a newline', () => {
    const lines = toRenderLines(highlightPlainLines('x\ny\nz'), 'x\ny\nz');
    expect(lines).toEqual(['x\n', 'y\n', 'z']);
  });
});

describe('caretLineCol', () => {
  it('counts lines and columns', () => {
    const text = 'abc\ndef\nghi';
    expect(caretLineCol(text, 0)).toEqual({ line: 0, col: 0 });
    expect(caretLineCol(text, 2)).toEqual({ line: 0, col: 2 });
    expect(caretLineCol(text, 4)).toEqual({ line: 1, col: 0 });
    expect(caretLineCol(text, 6)).toEqual({ line: 1, col: 2 });
    expect(caretLineCol(text, text.length)).toEqual({ line: 2, col: 3 });
  });

  it('is NOT affected by long lines above: no soft wrapping (the old mirror drifted down)', () => {
    const long = 'x'.repeat(5000);
    const text = `${long}\n${long}\n${long}\nfoo`;
    // каретка в конце слова «foo» на 4-й строке — ровно строка 3, колонка 3
    expect(caretLineCol(text, text.length)).toEqual({ line: 3, col: 3 });
  });

  it('aligns tabs to the tab size', () => {
    expect(caretLineCol('\tx', 2, 4)).toEqual({ line: 0, col: 5 });
    expect(caretLineCol('ab\tx', 4, 4)).toEqual({ line: 0, col: 5 }); // "ab" → до колонки 4, затем x
    expect(caretLineCol('abcd\tx', 6, 4)).toEqual({ line: 0, col: 9 });
  });

  it('clamps an out-of-range cursor', () => {
    expect(caretLineCol('ab\ncd', 999)).toEqual({ line: 1, col: 2 });
    expect(caretLineCol('ab', -5)).toEqual({ line: 0, col: 0 });
    expect(caretLineCol('', 0)).toEqual({ line: 0, col: 0 });
  });
});
