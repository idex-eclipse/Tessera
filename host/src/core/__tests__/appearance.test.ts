import { describe, expect, it } from 'vitest';
import { contrastRatio, readableAccent } from '../appearance';

/** Check extreme user colors against both high contrast surfaces. */
describe('high contrast accents', () => {
  it('keeps accessible custom accents on each palette', () => {
    for (const color of ['#000000', '#ffffff', '#4285f4', '#ffdc00', '#777777']) {
      expect(contrastRatio(readableAccent(color, 'light'), '#ffffff')).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(readableAccent(color, 'dark'), '#141414')).toBeGreaterThanOrEqual(4.5);
    }
  });
});
