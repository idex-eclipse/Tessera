import { describe, expect, it } from 'vitest';

import { EDGES, VERTICES, VIEW, project } from '../loader/tesseract';

describe('tesseract', () => {
  it('has 16 vertices and 32 edges of unit length', () => {
    expect(VERTICES).toHaveLength(16);
    expect(EDGES).toHaveLength(32);
    for (const [a, b] of EDGES) {
      const va = VERTICES[a]!;
      const vb = VERTICES[b]!;
      const d = va.reduce((sum, c, i) => sum + Math.abs(c - vb[i]!), 0);
      expect(d).toBe(2);
    }
  });

  it('projects to finite points inside the view box at any angle', () => {
    for (let i = 0; i < 400; i++) {
      const t = i * 0.37;
      const pts = project({ xw: t * 0.9, zw: t * 0.55, xz: t * 0.35, yz: t * 0.22 });
      for (const p of pts) {
        expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
        expect(p.x).toBeGreaterThan(-VIEW * 0.2);
        expect(p.x).toBeLessThan(VIEW * 1.2);
        expect(p.y).toBeGreaterThan(-VIEW * 0.2);
        expect(p.y).toBeLessThan(VIEW * 1.2);
        expect(p.depth).toBeGreaterThanOrEqual(0);
        expect(p.depth).toBeLessThanOrEqual(1);
      }
    }
  });
});
