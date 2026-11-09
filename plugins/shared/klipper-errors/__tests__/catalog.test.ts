import { describe, expect, it } from 'vitest';

import {
  getKlipperErrorHint,
  getKlipperErrorHintUi,
  KLIPPER_ERROR_HINT_IDS,
  matchKlipperError,
  normalizeKlipperError,
  type KlipperErrorHintId,
} from '../catalog.ts';

const CASES: ReadonlyArray<[KlipperErrorHintId, string]> = [
  ['timer-too-close', "!! MCU 'mcu' shutdown:\nTimer too close"],
  ['move-out-of-range', 'Move out of range: 301.000 20.000 0.000 [0.000]'],
  ['must-home-axis-first', 'Must home axis first: 10.000 0.000 0.000 [0.000]'],
  ['extrude-below-minimum-temp', "Extrude below minimum temp\nSee the 'min_extrude_temp' option"],
  ['mcu-connection', "Lost communication with MCU 'toolhead'"],
  ['mcu-protocol', 'MCU protocol error'],
  ['adc-out-of-range', "MCU 'mcu' shutdown: ADC out of range"],
  ['heater-not-heating', 'Heater extruder not heating at expected rate'],
  ['tmc-reports-error', "TMC 'stepper_x' reports error: DRV_STATUS: ffffffff"],
  ['tmc-communication', "Unable to read tmc uart 'stepper_x' register IFCNT"],
  ['endstop-trigger', 'Endstop x still triggered after retract'],
  ['probe-trigger', 'Probe triggered prior to movement'],
  ['bltouch', 'BLTouch failed to verify sensor state'],
  ['homing-communication-timeout', 'Communication timeout during homing'],
  ['mcu-shutdown', "MCU 'aux' shutdown: Some future firmware reason"],
];

describe('Klipper error catalog', () => {
  it('covers every curated family with a stable id', () => {
    expect(KLIPPER_ERROR_HINT_IDS).toHaveLength(15);
    expect(new Set(KLIPPER_ERROR_HINT_IDS).size).toBe(15);
    for (const [id, message] of CASES) expect(matchKlipperError(message), message).toBe(id);
  });

  it('matches variants while keeping specific MCU causes ahead of the generic fallback', () => {
    expect(matchKlipperError("mcu 'can0': Unable to open serial port: missing")).toBe('mcu-connection');
    expect(matchKlipperError('No trigger on y after full movement')).toBe('endstop-trigger');
    expect(matchKlipperError('No trigger on probe after full movement')).toBe('probe-trigger');
    expect(matchKlipperError("MCU 'mcu' shutdown: Timer too close")).toBe('timer-too-close');
    expect(matchKlipperError("MCU 'mcu' shutdown: ADC out of range")).toBe('adc-out-of-range');
  });

  it('normalizes transport prefixes and whitespace but leaves unknown errors unmatched', () => {
    expect(normalizeKlipperError('  !!  Move\nout  of   range  ')).toBe('Move out of range');
    expect(matchKlipperError('Unknown command: SOMETHING_NEW')).toBeNull();
    expect(matchKlipperError('')).toBeNull();
  });

  it('returns Russian and English copy and falls back to English', () => {
    const en = getKlipperErrorHint('timer-too-close', 'en-US')!;
    const ru = getKlipperErrorHint('timer-too-close', 'ru-RU')!;
    const fallback = getKlipperErrorHint('timer-too-close', 'de-DE')!;

    expect(ru.title).not.toBe(en.title);
    expect(fallback.title).toBe(en.title);
    expect(en.checks.length).toBeGreaterThan(1);
    expect(getKlipperErrorHint('not-a-real-id', 'en')).toBeNull();
    expect(getKlipperErrorHintUi('ru').open).toContain('Пояснить');
  });
});
