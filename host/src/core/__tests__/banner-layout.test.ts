import { describe, expect, it } from 'vitest';

import { computeBannerLayout, type BannerMeasure } from '../banner-layout';

const banner = (key: string, fullHeight: number, collapsedHeight = 40): BannerMeasure => ({
  key,
  fullHeight,
  collapsedHeight,
});

const wide = (available: number, ...banners: BannerMeasure[]) => {
  const layout = computeBannerLayout({ narrow: false, available, banners });
  return { collapsed: [...layout.collapsed], grouped: layout.grouped };
};

describe('computeBannerLayout / wide', () => {
  it('leaves banners alone while they fit', () => {
    expect(wide(1000, banner('a', 200), banner('b', 200))).toEqual({ collapsed: [], grouped: false });
  });

  it('step 1: collapses only the banner that is too tall', () => {
    expect(wide(1000, banner('a', 350))).toEqual({ collapsed: [], grouped: false });
    expect(wide(1000, banner('a', 351))).toEqual({ collapsed: ['a'], grouped: false });
    expect(wide(1000, banner('a', 500), banner('b', 100))).toEqual({ collapsed: ['a'], grouped: false });
  });

  it('step 2: collapses all at once when together they take too much', () => {
    expect(wide(1000, banner('a', 200), banner('b', 201))).toEqual({
      collapsed: ['a', 'b'],
      grouped: false,
    });
  });

  it('step 2 counts a banner collapsed on step 1 by its collapsed height', () => {
    expect(wide(1000, banner('a', 500), banner('b', 340))).toEqual({
      collapsed: ['a'],
      grouped: false,
    });
    expect(wide(1000, banner('a', 500), banner('b', 340), banner('c', 21))).toEqual({
      collapsed: ['a', 'b', 'c'],
      grouped: false,
    });
  });

  it('step 3: groups when even the collapsed rows take too much', () => {
    const many = (collapsedHeight: number) =>
      ['a', 'b', 'c', 'd', 'e'].map((key) => banner(key, 100, collapsedHeight));
    expect(wide(1000, ...many(50)).grouped).toBe(false);
    expect(wide(1000, ...many(51)).grouped).toBe(true);
  });

  it('does not group a single banner', () => {
    expect(wide(100, banner('a', 500, 90))).toEqual({ collapsed: ['a'], grouped: false });
  });

  it('ignores banners with nothing to report', () => {
    expect(wide(1000, banner('a', 0), banner('b', 100))).toEqual({ collapsed: [], grouped: false });
  });

  it('does nothing until the work area is measured', () => {
    expect(wide(0, banner('a', 500))).toEqual({ collapsed: [], grouped: false });
  });
});

describe('computeBannerLayout / narrow', () => {
  const narrow = (...banners: BannerMeasure[]) => {
    const layout = computeBannerLayout({ narrow: true, available: 2000, banners });
    return { collapsed: [...layout.collapsed], grouped: layout.grouped };
  };

  it('collapses a single banner without an accordion', () => {
    expect(narrow(banner('a', 10))).toEqual({ collapsed: ['a'], grouped: false });
  });

  it('groups two or more visible banners', () => {
    expect(narrow(banner('a', 10), banner('b', 10))).toEqual({ collapsed: ['a', 'b'], grouped: true });
    expect(narrow(banner('a', 10), banner('b', 0))).toEqual({ collapsed: ['a'], grouped: false });
  });
});
