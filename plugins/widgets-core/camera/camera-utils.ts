const SWIPE_MIN_PX = 40;
const SWIPE_AXIS_RATIO = 1.5;
const SWIPE_MAX_MS = 800;
const FPS_WINDOW_MS = 1000;

/**
 * Направление листания по жесту. В LTR свайп влево = следующая камера,
 * в RTL — зеркально. Преимущественно вертикальный или медленный жест — не свайп.
 */
export function swipeDirection(
  dx: number,
  dy: number,
  dt: number,
  rtl: boolean,
): 'prev' | 'next' | null {
  if (dt > SWIPE_MAX_MS) return null;
  if (Math.abs(dx) < SWIPE_MIN_PX) return null;
  if (Math.abs(dx) < Math.abs(dy) * SWIPE_AXIS_RATIO) return null;
  const toNext = rtl ? dx > 0 : dx < 0;
  return toNext ? 'next' : 'prev';
}

/** FPS по скользящему окну ~1 с. `fps()` = null, пока не набралось два кадра. */
export function createFpsMeter(now: () => number = () => performance.now()) {
  let stamps: number[] = [];

  function trim(t: number): void {
    const from = t - FPS_WINDOW_MS;
    let i = 0;
    while (i < stamps.length && (stamps[i] ?? 0) < from) i++;
    if (i > 0) stamps = stamps.slice(i);
  }

  return {
    tick(): void {
      const t = now();
      stamps.push(t);
      trim(t);
    },
    fps(): number | null {
      trim(now());
      if (stamps.length < 2) return null;
      const first = stamps[0] ?? 0;
      const last = stamps[stamps.length - 1] ?? first;
      const span = last - first;
      return span > 0 ? ((stamps.length - 1) * 1000) / span : null;
    },
    reset(): void {
      stamps = [];
    },
  };
}

/** Круговой сдвиг индекса; при пустом списке — 0. */
export function cycleIndex(i: number, delta: number, len: number): number {
  if (len <= 0) return 0;
  return (((i + delta) % len) + len) % len;
}

/**
 * Список камер из ответа `server.webcams.list` ({ webcams }) или из params
 * `notify_webcams_changed` (массив-обёртка [{ webcams }]). Непонятная форма → null.
 */
export function extractWebcams(params: unknown): unknown[] | null {
  let p: unknown = params;
  if (Array.isArray(p) && p.length === 1 && p[0] && !Array.isArray(p[0]) && typeof p[0] === 'object') {
    if ('webcams' in (p[0] as object)) p = p[0];
  }
  if (Array.isArray(p)) return p;
  const list = (p as { webcams?: unknown } | null)?.webcams;
  return Array.isArray(list) ? list : null;
}
