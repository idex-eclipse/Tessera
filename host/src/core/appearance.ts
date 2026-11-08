/** Shared color math for readable accents in either high contrast palette. */
function linear(channel: number): number {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

/** Return the WCAG contrast ratio of two opaque hex colors. */
export function contrastRatio(first: string, second: string): number {
  const luminance = (hex: string): number => {
    const bytes = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));
    return 0.2126 * linear(bytes[0] ?? 0) + 0.7152 * linear(bytes[1] ?? 0) + 0.0722 * linear(bytes[2] ?? 0);
  };
  const a = luminance(first);
  const b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** Preserve the chosen hue while making accent text readable on the surface. */
export function readableAccent(color: string, theme: 'light' | 'dark'): string {
  const surface = theme === 'light' ? '#ffffff' : '#141414';
  const target = theme === 'light' ? 0 : 255;
  const source = [1, 3, 5].map((at) => parseInt(color.slice(at, at + 2), 16));
  for (let step = 0; step <= 100; step += 1) {
    const amount = step / 100;
    const hex = `#${source.map((channel) => Math.round(channel * (1 - amount) + target * amount).toString(16).padStart(2, '0')).join('')}`;
    if (contrastRatio(hex, surface) >= 4.5) return hex;
  }
  return theme === 'light' ? '#000000' : '#ffffff';
}
