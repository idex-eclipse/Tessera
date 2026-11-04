import { describe, expect, it } from 'vitest';
import {
  FILTER_MS_DEFAULT,
  FILTER_MS_MAX,
  FILTER_MS_MIN,
  applyFilter,
  clampFilterMs,
  parseFilterKind,
} from '../load-cell/force-filter';

// 10 ms apart, so a 50 ms window covers 5 samples
const xs = [0, 0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.07, 0.08, 0.09];
const ys = [1, 1, 1, 1, 1, 9, 1, 1, 1, 1];

describe('force filter settings', () => {
  it('clamps the window and falls back to the default', () => {
    expect(clampFilterMs(5)).toBe(FILTER_MS_MIN);
    expect(clampFilterMs(99999)).toBe(FILTER_MS_MAX);
    expect(clampFilterMs(120.4)).toBe(120);
    expect(clampFilterMs('x')).toBe(FILTER_MS_DEFAULT);
    expect(clampFilterMs(NaN)).toBe(FILTER_MS_DEFAULT);
  });

  it('parses a stored kind, defaulting to raw', () => {
    expect(parseFilterKind('median')).toBe('median');
    expect(parseFilterKind('nope')).toBe('raw');
    expect(parseFilterKind(undefined)).toBe('raw');
  });
});

describe('applyFilter', () => {
  it('returns the input untouched for raw and for empty series', () => {
    expect(applyFilter('raw', 100, xs, ys).cols[0]).toBe(ys);
    expect(applyFilter('median', 100, [], [])).toEqual({ xs: [], cols: [[]] });
  });

  it('keeps one value per sample for every kind', () => {
    for (const kind of ['average', 'moving', 'median', 'envelope'] as const) {
      const r = applyFilter(kind, 50, xs, ys);
      expect(r.xs).toBe(xs);
      for (const col of r.cols) expect(col).toHaveLength(xs.length);
    }
    expect(applyFilter('envelope', 50, xs, ys).cols).toHaveLength(2);
  });

  it('averages fixed bins anchored to absolute time', () => {
    // 50 ms bins: [0,.05) -> five 1s, [.05,.1) -> 9,1,1,1,1
    const [col] = applyFilter('average', 50, xs, ys).cols;
    expect(col!.slice(0, 5)).toEqual([1, 1, 1, 1, 1]);
    expect(col![5]).toBeCloseTo(13 / 5);
    expect(col![9]).toBeCloseTo(13 / 5);
  });

  it('keeps bin edges when old samples drop off the left', () => {
    const full = applyFilter('average', 50, xs, ys).cols[0]!;
    const cut = applyFilter('average', 50, xs.slice(5), ys.slice(5)).cols[0]!;
    expect(cut).toEqual(full.slice(5));
  });

  it('moves a trailing average over the window', () => {
    // 0.25 s steps are exact in binary floating point, so the window edge is unambiguous:
    // a 1000 ms window holds exactly the last four samples
    const x = [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
    const y = [1, 1, 1, 1, 9, 1, 1, 1, 1];
    const [col] = applyFilter('moving', 1000, x, y).cols;
    expect(col![0]).toBe(1);
    expect(col![4]).toBe((1 + 1 + 1 + 9) / 4);
    // still inside the window of the last sample that sees it...
    expect(col![7]).toBe((9 + 1 + 1 + 1) / 4);
    // ...and gone one sample later
    expect(col![8]).toBe(1);
  });

  it('removes a single spike with the median', () => {
    const [col] = applyFilter('median', 50, xs, ys).cols;
    expect(col!.every((v) => v === 1)).toBe(true);
  });

  it('draws min and max per bin for the envelope', () => {
    const [lo, hi] = applyFilter('envelope', 50, xs, ys).cols;
    expect(lo!.slice(5)).toEqual([1, 1, 1, 1, 1]);
    expect(hi!.slice(5)).toEqual([9, 9, 9, 9, 9]);
    expect(hi!.slice(0, 5)).toEqual([1, 1, 1, 1, 1]);
  });
});
