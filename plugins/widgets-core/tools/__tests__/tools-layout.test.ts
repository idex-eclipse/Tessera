import { describe, expect, it } from 'vitest';

import { forceMoveRowFit, rowsFit, rowsMinWidth } from '../tools-layout';

describe('forceMoveRowFit', () => {
  it('needs room for six step buttons and the stepper name', () => {
    expect(forceMoveRowFit(336)).toBe(true);
    expect(forceMoveRowFit(335)).toBe(false);
    expect(forceMoveRowFit(0)).toBe(true);
  });
});

describe('rowsMinWidth', () => {
  it('counts the step buttons on both sides and the position field', () => {
    expect(rowsMinWidth(6)).toBe(652);
    expect(rowsMinWidth(3)).toBe(376);
  });
});

describe('rowsFit', () => {
  it('fits exactly at the minimum width', () => {
    expect(rowsFit(652, 6)).toBe(true);
    expect(rowsFit(651, 6)).toBe(false);
  });

  it('fits until the width is measured', () => {
    expect(rowsFit(0, 6)).toBe(true);
  });
});
