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

/** Угловые скорости вращения, рад/с. */
const RATES: Rotation = { xw: 0.9, zw: 0.55, xz: 0.35, yz: 0.22 };

const ZERO: Rotation = { xw: 0, zw: 0, xz: 0, yz: 0 };

const ANGLES = ['xw', 'zw', 'xz', 'yz'] as const;

function advance(r: Rotation, seconds: number): Rotation {
  return {
    xw: r.xw + RATES.xw * seconds,
    zw: r.zw + RATES.zw * seconds,
    xz: r.xz + RATES.xz * seconds,
    yz: r.yz + RATES.yz * seconds,
  };
}

/**
 * Поза логотипа (host/public/logo.svg): 4D-повороты нулевые, а обычный куб развёрнут
 * изометрически — диагональ (1,1,1) смотрит в камеру, силуэт даёт правильный шестигранник.
 */
const LOGO_POSE: Rotation = { xw: 0, zw: 0, xz: Math.PI / 4, yz: Math.atan(Math.SQRT1_2) };

/** Радиус шестигранника для куба с ребром 2 в изометрии: √(8/3). */
const ISO_RADIUS = Math.sqrt(8 / 3);

/** logo.svg нарисован в viewBox 64; внешний куб — w = +1 (ближе к камере, крупнее). */
const LOGO_SCALE = VIEW / 64;
const LOGO_OUTER = { cy: 31 * LOGO_SCALE, r: 26 * LOGO_SCALE };
const LOGO_INNER = { cy: 35 * LOGO_SCALE, r: 12.5 * LOGO_SCALE };

/**
 * Точные вершины логотипа. Перспективная проекция из `project` даёт в той же позе
 * чуть другие пропорции, поэтому к концу остановки анимация подтягивается к этим точкам.
 */
const LOGO_POINTS: ProjectedPoint[] = VERTICES.map(([x, y, z, w]) => {
  const [px, pz] = rotate(x, z, LOGO_POSE.xz);
  const [py] = rotate(y, pz, LOGO_POSE.yz);
  const ring = w > 0 ? LOGO_OUTER : LOGO_INNER;
  const k = ring.r / ISO_RADIUS;
  return { x: VIEW / 2 + px * k, y: ring.cy + py * k, depth: 1 };
});

/** Сколько секунд тессеракт доворачивается до позы логотипа и сколько разгоняется обратно. */
const SETTLE_S = 1.8;
const RELEASE_S = 0.6;

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
const smoothstep = (a: number, b: number, x: number): number => {
  const k = clamp01((x - a) / (b - a));
  return k * k * (3 - 2 * k);
};

function blend(from: ProjectedPoint[], to: ProjectedPoint[], k: number): ProjectedPoint[] {
  return from.map((p, i) => {
    const q = to[i]!;
    return {
      x: p.x + (q.x - p.x) * k,
      y: p.y + (q.y - p.y) * k,
      depth: p.depth + (q.depth - p.depth) * k,
    };
  });
}

export interface TesseractHandle {
  destroy(): void;
  /**
   * Останавливает вращение в позе логотипа или запускает его снова.
   * Возвращает true, если тессеракт теперь останавливается.
   */
  toggle(): boolean;
}

interface Instance {
  lines: SVGLineElement[];
  tick(t: number): void;
}

const instances = new Set<Instance>();
let rafId = 0;
let t0 = 0;

/** Время в секундах на той же шкале, что и `t` в кадре; 0, пока кадров ещё не было. */
function currentTime(): number {
  return t0 ? (performance.now() - t0) / 1000 : 0;
}

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

export interface TesseractOptions {
  /** Сразу стоять в позе логотипа (без анимации), пока не вызовут `toggle()`. */
  parked?: boolean;
}

/**
 * Рисует тессеракт в переданном `<svg>` линиями со `stroke="currentColor"`.
 */
export function createTesseract(svg: SVGSVGElement, options: TesseractOptions = {}): TesseractHandle {
  svg.setAttribute('viewBox', `0 0 ${VIEW} ${VIEW}`);

  const lines = EDGES.map(() => {
    const line = document.createElementNS(SVG_NS, 'line');
    svg.appendChild(line);
    return line;
  });

  // spin: base + RATES·(t − spinFrom). settle/release: base — углы в момент начала фазы,
  // phaseFrom — её начало. parked — вне тикера, кадр уже нарисован.
  let mode: 'spin' | 'settle' | 'release' | 'parked' = 'spin';
  let base: Rotation = ZERO;
  let spinFrom = 0;
  let phaseFrom = 0;
  let delta: Rotation = ZERO;
  let cur: Rotation = ZERO;
  let blendFrom = 0;
  let blendNow = 0;

  const inst: Instance = {
    lines,
    tick(t) {
      let k = 0;
      if (mode === 'spin') {
        cur = advance(base, t - spinFrom);
      } else if (mode === 'settle') {
        const p = clamp01((t - phaseFrom) / SETTLE_S);
        const e = 1 - (1 - p) * (1 - p);
        cur = {
          xw: base.xw + delta.xw * e,
          zw: base.zw + delta.zw * e,
          xz: base.xz + delta.xz * e,
          yz: base.yz + delta.yz * e,
        };
        k = blendFrom + (1 - blendFrom) * smoothstep(0.4, 1, p);
        if (p >= 1) {
          mode = 'parked';
          cur = LOGO_POSE;
          instances.delete(inst);
        }
      } else if (mode === 'release') {
        const s = t - phaseFrom;
        const p = clamp01(s / RELEASE_S);
        // Скорость нарастает линейно за RELEASE_S, дальше постоянная.
        cur = advance(base, s < RELEASE_S ? (s * s) / (2 * RELEASE_S) : s - RELEASE_S / 2);
        k = blendFrom * (1 - smoothstep(0, 1, p));
        if (p >= 1) {
          mode = 'spin';
          spinFrom = phaseFrom + RELEASE_S / 2;
        }
      }
      blendNow = k;
      draw(lines, k > 0 ? blend(project(cur), LOGO_POINTS, k) : project(cur));
    },
  };
  if (options.parked) {
    mode = 'parked';
    cur = LOGO_POSE;
    blendNow = 1;
    draw(lines, LOGO_POINTS);
  } else {
    inst.tick(0);
    instances.add(inst);
    ensureLoop();
  }

  return {
    destroy() {
      instances.delete(inst);
      lines.forEach((l) => l.remove());
    },
    toggle() {
      const t = currentTime();
      base = mode === 'spin' ? advance(base, t - spinFrom) : cur;
      blendFrom = blendNow;
      phaseFrom = t;
      if (mode === 'spin' || mode === 'release') {
        // Довернуть вперёд до позы логотипа, не замедляясь сильнее, чем при обычном вращении.
        const d = {} as Record<(typeof ANGLES)[number], number>;
        for (const a of ANGLES) {
          const full = Math.PI * 2;
          let v = (((LOGO_POSE[a] - base[a]) % full) + full) % full;
          while (v < (RATES[a] * SETTLE_S) / 2) v += full;
          d[a] = v;
        }
        delta = d;
        mode = 'settle';
      } else {
        mode = 'release';
      }
      instances.add(inst);
      ensureLoop();
      return mode === 'settle';
    },
  };
}
