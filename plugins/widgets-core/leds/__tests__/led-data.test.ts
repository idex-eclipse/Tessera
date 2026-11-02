import { describe, expect, it } from 'vitest';

import {
  buildSetLed,
  buildSetTemplate,
  colorToCss,
  gcodeValue,
  parseColorData,
  parseLedItems,
  parseTemplates,
  withBrightness,
  type LedItem,
} from '../led-data';

const OBJECTS = [
  'toolhead',
  'led status',
  'led rgbw',
  'neopixel case',
  'neopixel bar_rgbw',
  'dotstar strip',
  'pca9533 board',
  'pca9632 panel',
  'output_pin led',
  'display_template blink',
];

const SETTINGS = {
  'led status': { red_pin: 'PA1', green_pin: 'PA2', blue_pin: 'PA3' },
  'led rgbw': { red_pin: 'PA1', white_pin: 'PA4' },
  'neopixel case': { pin: 'PB0', chain_count: 12, color_order: ['GRB'] },
  'neopixel bar_rgbw': { pin: 'PB1', chain_count: 3, color_order: 'GRBW' },
  'dotstar strip': { data_pin: 'PC0', clock_pin: 'PC1', chain_count: 5 },
  'pca9533 board': {},
  'pca9632 panel': { color_order: 'RGB' },
  'display_template blink': { text: '{param_on}, 0, 0, 0', param_on: '1.0', param_label: "'x'" },
  'display_template alpha': { text: '' },
};

describe('parseLedItems', () => {
  const items = parseLedItems(OBJECTS, SETTINGS);
  const by = (id: string) => items.find((i) => i.id === id)!;

  it('finds only the LED kinds, in objects.list order', () => {
    expect(items.map((i) => i.id)).toEqual([
      'led status',
      'led rgbw',
      'neopixel case',
      'neopixel bar_rgbw',
      'dotstar strip',
      'pca9533 board',
      'pca9632 panel',
    ]);
  });

  it('reads chain_count and the white channel from the config', () => {
    expect(by('led status')).toMatchObject({ count: 1, hasWhite: false, name: 'status', label: 'Status' });
    expect(by('led rgbw').hasWhite).toBe(true);
    expect(by('neopixel case')).toMatchObject({ count: 12, hasWhite: false });
    expect(by('neopixel bar_rgbw')).toMatchObject({ count: 3, hasWhite: true, label: 'Bar Rgbw' });
    expect(by('dotstar strip')).toMatchObject({ count: 5, hasWhite: false });
    expect(by('pca9533 board')).toMatchObject({ count: 1, hasWhite: true });
    expect(by('pca9632 panel').hasWhite).toBe(false);
  });

  it('falls back to defaults without config', () => {
    const [np, pca] = parseLedItems(['neopixel x', 'pca9632 y'], {});
    expect(np).toMatchObject({ count: 1, hasWhite: false });
    expect(pca!.hasWhite).toBe(true);
  });
});

describe('parseTemplates', () => {
  it('collects display_template sections with their params, sorted by name', () => {
    expect(parseTemplates(SETTINGS)).toEqual([
      { name: 'alpha', text: '', params: {} },
      { name: 'blink', text: '{param_on}, 0, 0, 0', params: { on: '1.0', label: "'x'" } },
    ]);
  });
});

describe('G-code', () => {
  const strip: LedItem = { id: 'neopixel case', kind: 'neopixel', name: 'case', label: 'Case', count: 4, hasWhite: false };
  const rgbw: LedItem = { ...strip, name: 'bar', hasWhite: true };

  it('sets the whole chain without INDEX', () => {
    expect(buildSetLed(strip, [1, 0.5, 0.12345, 1])).toBe('SET_LED LED=case RED=1 GREEN=0.5 BLUE=0.123');
    expect(buildSetLed(strip, [1, 0, 0, 0], [0, 1, 2, 3])).toBe('SET_LED LED=case RED=1 GREEN=0 BLUE=0');
    expect(buildSetLed(rgbw, [0, 0, 0, 0.7])).toBe('SET_LED LED=bar RED=0 GREEN=0 BLUE=0 WHITE=0.7');
  });

  it('uses 1-based INDEX and transmits only on the last line', () => {
    expect(buildSetLed(strip, [0, 1, 0, 0], [2, 0])).toBe(
      'SET_LED LED=case RED=0 GREEN=1 BLUE=0 INDEX=1 TRANSMIT=0\n' +
        'SET_LED LED=case RED=0 GREEN=1 BLUE=0 INDEX=3 TRANSMIT=1',
    );
  });

  it('clamps channels and ignores out-of-range indices', () => {
    expect(buildSetLed(strip, [2, -1, NaN, 0], [9])).toBe('SET_LED LED=case RED=1 GREEN=0 BLUE=0');
  });

  it('assigns and clears templates', () => {
    expect(buildSetTemplate(strip, 'blink', { on: '0.5', label: "'a b'", empty: ' ' })).toBe(
      `SET_LED_TEMPLATE LED=case TEMPLATE=blink PARAM_ON=0.5 PARAM_LABEL="'a b'"`,
    );
    expect(buildSetTemplate(strip, null, { on: '1' }, [1])).toBe('SET_LED_TEMPLATE LED=case TEMPLATE= INDEX=2');
  });

  it('quotes values for shlex', () => {
    expect(gcodeValue('case')).toBe('case');
    expect(gcodeValue('my led')).toBe('"my led"');
    expect(gcodeValue('say "hi"')).toBe('"say \\"hi\\""');
  });
});

describe('colors', () => {
  it('normalizes color_data to the chain length', () => {
    expect(parseColorData([[1, 0.5, 0, 0], [2, -1]], 3)).toEqual([
      [1, 0.5, 0, 0],
      [1, 0, 0, 0],
      [0, 0, 0, 0],
    ]);
    expect(parseColorData(null, 1)).toEqual([[0, 0, 0, 0]]);
  });

  it('mixes white into the preview', () => {
    expect(colorToCss([1, 0, 0, 0.5])).toBe('rgb(255, 128, 128)');
  });

  it('scales brightness, lighting a dark LED in white', () => {
    expect(withBrightness([1, 0.5, 0, 0], 0.5, false)).toEqual([0.5, 0.25, 0, 0]);
    expect(withBrightness([0, 0, 0, 0], 0.4, false)).toEqual([0.4, 0.4, 0.4, 0]);
    expect(withBrightness([0, 0, 0, 0], 0.4, true)).toEqual([0, 0, 0, 0.4]);
  });
});
