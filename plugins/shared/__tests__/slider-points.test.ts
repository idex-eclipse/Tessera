import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { SURFACE_SPECS } from '../../../host/src/core/surfaces';
import { SLIDER_EVENTS, SLIDER_POINT_ID, sliderPoints } from '../slider-field/extension-points';

const SLIDER_SRC = readFileSync(join(__dirname, '..', 'slider-field', 'SliderField.svelte'), 'utf8');

describe('shared SliderField extension point', () => {
  it('declares one valid replacement point with the given title prefix', () => {
    const validate = SURFACE_SPECS.extensionPoints.validate!;
    const points = sliderPoints('acme');
    expect(points).toHaveLength(1);
    expect(validate(points[0]), 'slider').toBe(true);
    expect(points[0]).toMatchObject({ id: SLIDER_POINT_ID, kind: 'element', mode: 'replacement', titleKey: 'acme.ext.slider' });
  });

  // The id and the events are shared constants, so SliderField.svelte must reference them, otherwise the point is dead API.
  it('SliderField.svelte renders the point and listens to both events', () => {
    expect(SLIDER_SRC).toContain('point={SLIDER_POINT_ID}');
    expect(SLIDER_SRC).toContain('SLIDER_EVENTS.commit');
    expect(SLIDER_SRC).toContain('SLIDER_EVENTS.reset');
  });

  it('keeps the event names namespaced like the other mpu: events', () => {
    for (const name of Object.values(SLIDER_EVENTS)) expect(name).toMatch(/^mpu:slider-/);
  });
});
