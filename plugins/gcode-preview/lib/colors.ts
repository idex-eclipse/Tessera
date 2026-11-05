export const EXTRUDER_COLORS = [0x4ea1ff, 0x3dd68c, 0xffb454, 0xff6b6b, 0xb78bff, 0x5ad0d6];

export function extruderRgb(ex: number): [number, number, number] {
  const c = EXTRUDER_COLORS[ex % EXTRUDER_COLORS.length] ?? 0x4ea1ff;
  return [(c >> 16) & 255, (c >> 8) & 255, c & 255];
}

export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
  };
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

// Золотой угол — соседние типы получают максимально разные оттенки
export function typeRgb(idx: number): [number, number, number] {
  return hslToRgb((idx * 137.508) % 360, 0.75, 0.6);
}