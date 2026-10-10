export function niceStep(rawStep: number): number {
  if (!Number.isFinite(rawStep) || rawStep <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(rawStep));
  const norm = rawStep / mag;

  let nice: number;
  if (norm <= 1) nice = 1;
  else if (norm <= 2) nice = 2;
  else if (norm <= 2.5) nice = 2.5;
  else if (norm <= 5) nice = 5;
  else nice = 10;

  return nice * mag;
}

export function niceRange(min: number, max: number, divisions: number): [number, number] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  if (max - min < 1e-9) {
    min -= 1;
    max += 1;
  }
  const step = niceStep((max - min) / divisions);
  return [Math.floor(min / step) * step, Math.ceil(max / step) * step];
}

export function linspace(min: number, max: number, count: number): number[] {
  if (count < 2) return [min];
  const out: number[] = [];
  const step = (max - min) / (count - 1);
  for (let i = 0; i < count; i++) out.push(min + step * i);
  return out;
}