import { describe, expect, it } from 'vitest';

import { createCollapseOnScroll } from '../collapse-on-scroll';

const SCROLLER = {};

describe('createCollapseOnScroll', () => {
  it('fires only after scrolling down past the threshold', () => {
    const c = createCollapseOnScroll({ threshold: 32 });
    expect(c.update(SCROLLER, 32)).toBe(false);
    expect(c.update(SCROLLER, 33)).toBe(true);
  });

  it('fires on a single large wheel step from the top', () => {
    const c = createCollapseOnScroll({ threshold: 32 });
    expect(c.update(SCROLLER, 300)).toBe(true);
  });

  it('never fires while scrolling up, down to the very top', () => {
    const c = createCollapseOnScroll({ threshold: 32 });
    c.update(SCROLLER, 500);
    expect(c.update(SCROLLER, 300)).toBe(false);
    expect(c.update(SCROLLER, 0)).toBe(false);
  });

  it('measures the threshold from the lowest point after scrolling up', () => {
    const c = createCollapseOnScroll({ threshold: 32 });
    c.update(SCROLLER, 500);
    c.update(SCROLLER, 400);
    expect(c.update(SCROLLER, 432)).toBe(false);
    expect(c.update(SCROLLER, 433)).toBe(true);
  });

  it('does not fire right after a surface was expanded mid-page', () => {
    const c = createCollapseOnScroll({ threshold: 32 });
    expect(c.update(SCROLLER, 500)).toBe(true);
    // пользователь нажал на поверхность и чуть сдвинул палец
    expect(c.update(SCROLLER, 510)).toBe(false);
    expect(c.update(SCROLLER, 533)).toBe(true);
  });

  it('keeps a separate anchor per scroll container', () => {
    const c = createCollapseOnScroll({ threshold: 32 });
    const inner = {};
    expect(c.update(SCROLLER, 500)).toBe(true);
    expect(c.update(inner, 10)).toBe(false);
    expect(c.update(SCROLLER, 510)).toBe(false);
    expect(c.update(inner, 43)).toBe(true);
  });

  it('sync moves the anchor without firing', () => {
    const c = createCollapseOnScroll({ threshold: 32 });
    c.sync(SCROLLER, 500);
    expect(c.update(SCROLLER, 520)).toBe(false);
    expect(c.update(SCROLLER, 533)).toBe(true);
  });
});
