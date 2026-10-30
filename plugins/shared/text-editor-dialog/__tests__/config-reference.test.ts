import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  parseHeaderLine,
  parseReference,
  pointToCell,
  resolveSection,
  sectionAbove,
  sectionAtCell,
  sectionInsideAt,
} from '../config-reference';

const SAMPLE = readFileSync(
  resolve(__dirname, 'fixtures/config-reference.sample.md'),
  'utf8',
);
const index = parseReference(SAMPLE);
const headingOf = (section: string) => resolveSection(index, section)?.heading;

describe('parseReference', () => {
  it('находит только заголовки секций вне ограждений и берёт первый для дублей', () => {
    expect([...index.byKey.keys()]).toEqual([
      'mcu',
      'mcu my_extra_mcu',
      'stepper',
      'gcode_macro',
      'bmi160',
      'mpu9250',
      'stepper_z1',
      'extruder1',
      'tmc2209',
      'display',
    ]);
    // [mcu] и [mcu my_extra_mcu] делят тип — по типу выигрывает первый
    expect(index.byType.get('mcu')?.heading).toBe('mcu');
  });

  it('CRLF и LF дают один и тот же результат', () => {
    const crlf = parseReference(SAMPLE.replace(/\n/g, '\r\n'));
    expect([...crlf.byKey.keys()]).toEqual([...index.byKey.keys()]);
    expect(resolveSection(crlf, 'mcu')?.body).toEqual(resolveSection(index, 'mcu')?.body);
  });

  it('`# …` внутри блока кода не считается заголовком', () => {
    const idx = parseReference('### [a]\n\n```\n### [fake]\n## fake\n```\n\n### [b]\ntext\n');
    expect([...idx.byKey.keys()]).toEqual(['a', 'b']);
    expect(resolveSection(idx, 'a')?.body).toEqual(['```', '### [fake]', '## fake', '```']);
  });
});

describe('resolveSection', () => {
  it('точное совпадение и совпадение по типу', () => {
    expect(headingOf('mcu')).toBe('mcu');
    expect(headingOf('mcu my_extra_mcu')).toBe('mcu my_extra_mcu');
    expect(headingOf('mcu extra')).toBe('mcu');
    expect(headingOf('gcode_macro START_PRINT')).toBe('gcode_macro');
    expect(headingOf('tmc2209 stepper_x')).toBe('tmc2209');
    expect(headingOf('  TMC2209   stepper_y ')).toBe('tmc2209');
  });

  it('оси stepper_* описаны в [stepper]', () => {
    for (const s of ['stepper_x', 'stepper_y', 'stepper_z', 'stepper_a', 'stepper_x1']) {
      expect(headingOf(s)).toBe('stepper');
    }
  });

  it('нумерованные секции откатываются к ...1', () => {
    expect(headingOf('stepper_z1')).toBe('stepper_z1');
    expect(headingOf('stepper_z2')).toBe('stepper_z1');
    expect(headingOf('extruder1')).toBe('extruder1');
    expect(headingOf('extruder3')).toBe('extruder1');
  });

  it('нет описания → null', () => {
    expect(resolveSection(index, 'display_status')).toBeNull();
    expect(resolveSection(index, 'tmc9999')).toBeNull();
    expect(resolveSection(index, '   ')).toBeNull();
  });

  it('фрагмент без заголовка и пустых краёв, подразделы #### внутри [display]', () => {
    const mcu = resolveSection(index, 'mcu');
    expect(mcu?.body[0]).toBe('Configuration of the primary micro-controller.');
    expect(mcu?.body.at(-1)).toBe('```');

    const display = resolveSection(index, 'display');
    expect(display?.body.some((l) => l.startsWith('#### hd44780 display'))).toBe(true);
    expect(display?.body.some((l) => l.startsWith('#### hd44780_spi display'))).toBe(true);
  });

  it('фрагмент заканчивается на следующем ### / ##', () => {
    const stepper = resolveSection(index, 'stepper');
    expect(stepper?.body.join('\n')).not.toContain('Cartesian Kinematics');
    expect(stepper?.body.at(-1)).toBe('```');
  });
});

describe('поиск секции в тексте редактора', () => {
  const text = '[printer]\nkinematics: cartesian\n\n  [tmc2209 stepper_x]\nuart_pin: PC11\n';

  it('parseHeaderLine разбирает строку заголовка и границы скобок', () => {
    expect(parseHeaderLine('[stepper_x]')).toEqual({ name: 'stepper_x', from: 0, to: 11 });
    expect(parseHeaderLine('  [ tmc2209  stepper_x ] # c')).toEqual({
      name: 'tmc2209  stepper_x',
      from: 2,
      to: 24,
    });
    expect(parseHeaderLine('key: [1, 2]')).toBeNull();
    expect(parseHeaderLine('# [commented]')).toBeNull();
  });

  it('sectionInsideAt: только внутри [...] заголовка', () => {
    expect(sectionInsideAt(text, 0)?.name).toBe('printer');
    expect(sectionInsideAt(text, 4)?.name).toBe('printer');
    expect(sectionInsideAt(text, 9)?.name).toBe('printer');
    expect(sectionInsideAt(text, 10)).toBeNull(); // начало следующей строки
    expect(sectionInsideAt(text, text.indexOf('kinematics'))).toBeNull();
    expect(sectionInsideAt(text, text.indexOf('tmc2209') + 3)?.name).toBe('tmc2209 stepper_x');
    expect(sectionInsideAt(text, text.indexOf('[tmc2209') - 1)).toBeNull(); // в отступе до скобки
  });

  it('sectionAbove: ближайший заголовок выше или на строке каретки', () => {
    expect(sectionAbove(text, text.indexOf('kinematics'))?.name).toBe('printer');
    expect(sectionAbove(text, text.indexOf('uart_pin') + 2)?.name).toBe('tmc2209 stepper_x');
    expect(sectionAbove(text, 3)?.name).toBe('printer');
    expect(sectionAbove('a: 1\nb: 2\n', 5)).toBeNull();
  });

  it('pointToCell + sectionAtCell: клик по слою подсветки', () => {
    const box = {
      left: 100, top: 50, scrollLeft: 0, scrollTop: 0, padL: 10, padT: 10, charW: 8, lineH: 20,
    };
    // строка 0, символ 2 → x = 100 + 10 + 2*8 + 1, y = 50 + 10 + 5
    const cell = pointToCell(127, 65, box);
    expect(cell).toEqual({ line: 0, col: 2 });
    expect(sectionAtCell(text, cell.line, cell.col)?.name).toBe('printer');

    // строка 1 — не заголовок
    expect(sectionAtCell(text, 1, 3)).toBeNull();
    // правее закрывающей скобки
    expect(sectionAtCell(text, 0, 9)).toBeNull();
    // вне текста
    expect(sectionAtCell(text, 99, 0)).toBeNull();
    expect(sectionAtCell(text, -1, 0)).toBeNull();

    // прокрутка сдвигает строки
    expect(pointToCell(127, 65, { ...box, scrollTop: 20 }).line).toBe(1);
  });
});

// Настоящий справочник Klipper, если он лежит в корне проекта (во временной копии
// пользователя). Без файла тест пропускается — фикстура покрывает те же правила.
const REAL = resolve(__dirname, '../../../../Config_Reference.md');

describe.skipIf(!existsSync(REAL))('настоящий Config_Reference.md', () => {
  const real = parseReference(existsSync(REAL) ? readFileSync(REAL, 'utf8') : '');

  it('находит все секции и каждая заголовок резолвится сам в себя', () => {
    expect(real.byKey.size).toBeGreaterThan(100);
    for (const [key, entry] of real.byKey) {
      const fragment = resolveSection(real, key);
      expect(fragment, key).not.toBeNull();
      // по полному ключу — именно его заголовок, но [mcu]/[display] допускают пример-имя
      expect(fragment?.heading.split(' ')[0], key).toBe(entry.heading.split(' ')[0]);
    }
  });

  it('типичные секции пользовательских конфигов находят справку', () => {
    const names = [
      'printer', 'stepper_x', 'stepper_y', 'stepper_z', 'stepper_z1', 'stepper_z2',
      'extruder', 'extruder1', 'extruder2', 'heater_bed', 'heater_fan hotend_fan',
      'controller_fan board', 'temperature_fan chamber', 'fan', 'bed_mesh', 'probe',
      'bltouch', 'tmc2209 stepper_x', 'tmc2209 extruder', 'gcode_macro PRINT_START',
      'delayed_gcode x', 'idle_timeout', 'virtual_sdcard', 'pause_resume', 'mcu',
      'mcu EBB', 'safe_z_home', 'input_shaper', 'adxl345', 'resonance_tester',
      'neopixel led', 'output_pin x', 'filament_switch_sensor x', 'temperature_sensor x',
      'firmware_retraction', 'exclude_object', 'save_variables', 'display', 'include x',
    ];
    for (const n of names) {
      expect(resolveSection(real, n), n).not.toBeNull();
    }
  });
});
