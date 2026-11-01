import { describe, expect, it } from 'vitest';

import { sectionsNeedAccordion, sliderColumns } from '../slider-field/slider-layout';

describe('sliderColumns', () => {
  it('uses two columns from 496px on a wide dashboard', () => {
    expect(sliderColumns(496, false)).toBe(2);
    expect(sliderColumns(495, false)).toBe(1);
  });

  it('always uses one column in narrow mode', () => {
    expect(sliderColumns(700, true)).toBe(1);
    expect(sliderColumns(0, true)).toBe(1);
  });

  it('keeps two columns until the width is measured', () => {
    expect(sliderColumns(0, false)).toBe(2);
  });
});

describe('sectionsNeedAccordion', () => {
  it('compares the content with the available height, including gaps', () => {
    expect(sectionsNeedAccordion([100, 100], 8, 208)).toBe(false);
    expect(sectionsNeedAccordion([100, 100], 8, 207)).toBe(true);
  });

  it('adds no gap for a single section', () => {
    expect(sectionsNeedAccordion([100], 8, 100)).toBe(false);
  });

  it('does not ask for an accordion until the height is measured', () => {
    expect(sectionsNeedAccordion([500], 8, 0)).toBe(false);
  });
});
