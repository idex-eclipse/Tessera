import { afterEach, describe, expect, it, vi } from 'vitest';

import { EDGES, VERTICES, VIEW, createTesseract, project } from '../loader/tesseract';

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

describe('tesseract logo pose', () => {
  afterEach(() => vi.unstubAllGlobals());

  /** Минимальный DOM и ручной rAF: кадры крутятся тестом, а не таймером. */
  function setup() {
    let now = 1000;
    let pending: FrameRequestCallback | null = null;
    vi.stubGlobal('performance', { now: () => now });
    vi.stubGlobal('document', {
      hidden: false,
      addEventListener: () => {},
      createElementNS: () => {
        const attrs: Record<string, string> = {};
        return {
          attrs,
          setAttribute: (k: string, v: string) => void (attrs[k] = v),
          remove: () => {},
        };
      },
    });
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      pending = cb;
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {
      pending = null;
    });

    const lines: Array<{ attrs: Record<string, string> }> = [];
    const svg = {
      setAttribute: () => {},
      appendChild: (l: (typeof lines)[number]) => void lines.push(l),
    } as unknown as SVGSVGElement;

    const run = (seconds: number) => {
      for (let i = 0; i < seconds * 60; i++) {
        now += 1000 / 60;
        const cb = pending;
        pending = null;
        cb?.(now);
      }
    };
    return { svg, lines, run, isRunning: () => pending !== null };
  }

  const endpoints = (lines: Array<{ attrs: Record<string, string> }>) =>
    lines.flatMap((l) => [
      [Number(l.attrs.x1), Number(l.attrs.y1)] as const,
      [Number(l.attrs.x2), Number(l.attrs.y2)] as const,
    ]);

  it('stops on the logo.svg projection, then spins again', async () => {
    const { svg, lines, run, isRunning } = setup();
    const handle = createTesseract(svg);
    run(1);

    expect(handle.toggle()).toBe(true);
    run(3);
    expect(isRunning()).toBe(false);

    // logo.svg (viewBox 64 → 100): внешний шестигранник (32,5)…(32,57), центр (32,31).
    const k = VIEW / 64;
    const pts = endpoints(lines);
    const has = (x: number, y: number) =>
      pts.some(([px, py]) => Math.abs(px - x * k) < 0.1 && Math.abs(py - y * k) < 0.1);
    for (const [x, y] of [[32, 5], [54.5, 18], [54.5, 44], [32, 57], [9.5, 44], [9.5, 18]] as const) {
      expect(has(x, y)).toBe(true);
    }
    // внутренний шестигранник и центры обоих кубов
    for (const [x, y] of [[32, 22.5], [42.8, 28.8], [21.2, 41.2], [32, 47.5], [32, 31], [32, 35]] as const) {
      expect(has(x, y)).toBe(true);
    }

    const parked = JSON.stringify(endpoints(lines));
    expect(handle.toggle()).toBe(false);
    run(2);
    expect(isRunning()).toBe(true);
    expect(JSON.stringify(endpoints(lines))).not.toBe(parked);
    handle.destroy();
  });
});
