import { describe, expect, it } from 'vitest';

import { headerNeedsStacking } from '../widget-header-fit';

describe('headerNeedsStacking', () => {
  it('keeps one line when everything fits, gaps included', () => {
    expect(headerNeedsStacking(200, [100, 92], 8)).toBe(false);
  });

  it('stacks when the gaps push it over', () => {
    expect(headerNeedsStacking(200, [100, 93], 8)).toBe(true);
  });

  it('counts gaps only between blocks that are present', () => {
    expect(headerNeedsStacking(200, [100, 100, 0], 8)).toBe(true);
    expect(headerNeedsStacking(208, [100, 100, 0], 8)).toBe(false);
  });

  it('does not stack a lone title, however long', () => {
    expect(headerNeedsStacking(100, [500, 0, 0], 8)).toBe(false);
  });
});
