/**
 * Вращающийся тессеракт (4D-гиперкуб), проецируемый в 2D.
 *
 * Без зависимостей от фреймворка: годится и для Svelte-компонента, и для
 * стартового экрана до монтирования приложения. Все экземпляры делят один
 * rAF-тикер, поэтому десяток загрузчиков на странице не множит циклы анимации.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Сторона viewBox; тессеракт вписан с запасом под толщину линии. */
export const VIEW = 100;

/** 16 вершин: все комбинации (±1, ±1, ±1, ±1). */
export const VERTICES: ReadonlyArray<readonly [number, number, number, number]> = Array.from(
  { length: 16 },
  (_, i) =>
    [i & 1 ? 1 : -1, i & 2 ? 1 : -1, i & 4 ? 1 : -1, i & 8 ? 1 : -1] as const,
);

/** 32 ребра: пары вершин, различающиеся ровно одной координатой. */
export const EDGES: ReadonlyArray<readonly [number, number]> = (() => {
  const out: Array<[number, number]> = [];
  for (let i = 0; i < 16; i++) {
    for (let bit = 1; bit < 16; bit <<= 1) {
      const j = i ^ bit;
      if (j > i) out.push([i, j]);
    }
  }
  return out;
})();

export interface ProjectedPoint {
  x: number;
  y: number;
  /** 0 (дальняя) … 1 (ближняя), для затенения. */
  depth: number;
}

export interface Rotation {
  /** Вращения в плоскостях XW, ZW (4D) и XZ, YZ (обычные 3D), радианы. */
  xw: number;
  zw: number;
  xz: number;
  yz: number;
}

function rotate(a: number, b: number, angle: number): [number, number] {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [a * c - b * s, a * s + b * c];
}

/** Поворачивает вершины и проецирует 4D → 3D → 2D (две перспективы подряд). */
export function project(rot: Rotation): ProjectedPoint[] {
  const out: ProjectedPoint[] = [];
  for (const v of VERTICES) {
    let [x, y, z, w] = v;
    [x, w] = rotate(x, w, rot.xw);
    [z, w] = rotate(z, w, rot.zw);
    [x, z] = rotate(x, z, rot.xz);
    [y, z] = rotate(y, z, rot.yz);

    // |w| ≤ √4 = 2 после поворотов, поэтому 4D-камера на расстоянии 3 безопасна.
    const k4 = 1 / (3 - w);
    const x3 = x * k4;
    const y3 = y * k4;
    const z3 = z * k4;

    // 3D-камера: |z3| ≤ ~1.2, расстояние 2.4 исключает деление на ноль.
    const k3 = 1 / (2.4 - z3);
    const scale = VIEW * 0.5;
    out.push({
      x: VIEW / 2 + x3 * k3 * scale * 2.4,
      y: VIEW / 2 + y3 * k3 * scale * 2.4,
      depth: Math.min(1, Math.max(0, (z3 + 0.8) / 1.6)),
    });
  }
  return out;
}

function rotationAt(t: number): Rotation {
  return {
    xw: t * 0.9,
    zw: t * 0.55,
    xz: t * 0.35,
    yz: t * 0.22,
  };
}

export interface TesseractHandle {
  destroy(): void;
}

interface Instance {
  lines: SVGLineElement[];
  tick(t: number): void;
}

const instances = new Set<Instance>();
let rafId = 0;
let t0 = 0;

function frame(now: number): void {
  rafId = 0;
  if (instances.size === 0) return;
  if (!t0) t0 = now;
  const t = (now - t0) / 1000;
  for (const inst of instances) inst.tick(t);
  rafId = requestAnimationFrame(frame);
}

function ensureLoop(): void {
  if (rafId || instances.size === 0 || document.hidden) return;
  rafId = requestAnimationFrame(frame);
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = 0;
    } else {
      ensureLoop();
    }
  });
}

function draw(lines: SVGLineElement[], points: ProjectedPoint[]): void {
  for (let i = 0; i < EDGES.length; i++) {
    const [a, b] = EDGES[i]!;
    const pa = points[a]!;
    const pb = points[b]!;
    const line = lines[i]!;
    line.setAttribute('x1', pa.x.toFixed(2));
    line.setAttribute('y1', pa.y.toFixed(2));
    line.setAttribute('x2', pb.x.toFixed(2));
    line.setAttribute('y2', pb.y.toFixed(2));
    // Дальние рёбра бледнее — даёт ощущение глубины.
    const depth = (pa.depth + pb.depth) / 2;
    line.setAttribute('stroke-opacity', (0.25 + 0.75 * depth).toFixed(2));
  }
}

/**
 * Рисует тессеракт в переданном `<svg>` линиями со `stroke="currentColor"`.
 */
export function createTesseract(svg: SVGSVGElement): TesseractHandle {
  svg.setAttribute('viewBox', `0 0 ${VIEW} ${VIEW}`);

  const lines = EDGES.map(() => {
    const line = document.createElementNS(SVG_NS, 'line');
    svg.appendChild(line);
    return line;
  });

  const inst: Instance = {
    lines,
    tick: (t) => draw(lines, project(rotationAt(t))),
  };
  inst.tick(0);
  instances.add(inst);
  ensureLoop();

  return {
    destroy() {
      instances.delete(inst);
      lines.forEach((l) => l.remove());
    },
  };
}
