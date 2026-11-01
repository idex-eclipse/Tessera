import { describe, expect, it } from 'vitest';

import { chipsNeedAccordion } from '../chips-layout';

describe('chipsNeedAccordion', () => {
  it('needs an accordion only above the share of the work area', () => {
    expect(chipsNeedAccordion(250, 1000)).toBe(false);
    expect(chipsNeedAccordion(251, 1000)).toBe(true);
  });

  it('does nothing until the work area is measured', () => {
    expect(chipsNeedAccordion(500, 0)).toBe(false);
  });
});
