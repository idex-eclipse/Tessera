// Чистая логика LED: разбор objects.list / configfile.settings и сборка G-code.
// Без Svelte — тестируется напрямую.

export type LedKind = 'led' | 'neopixel' | 'dotstar' | 'pca9533' | 'pca9632';

export const LED_KINDS: readonly LedKind[] = ['led', 'neopixel', 'dotstar', 'pca9533', 'pca9632'];

export interface LedItem {
  id: string; // объект статуса: 'neopixel case'
  kind: LedKind;
  name: string; // имя для LED=
  label: string;
  /** пикселей в цепочке (1 у одиночных LED) */
  count: number;
  hasWhite: boolean;
}

export interface LedTemplate {
  name: string;
  text: string;
  /** param_<x> → python-литерал из конфига (как строка) */
  params: Record<string, string>;
}

/** [r, g, b, w], каждый 0..1 */
export type Rgbw = [number, number, number, number];

export const OFF: Rgbw = [0, 0, 0, 0];

export function prettify(name: string): string {
  return name
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function hasWhiteChannel(kind: LedKind, cfg: Record<string, unknown>): boolean {
  switch (kind) {
    case 'led':
      return cfg.white_pin != null;
    case 'pca9533':
      return true;
    case 'dotstar':
      return false;
    case 'neopixel':
    case 'pca9632': {
      // color_order: строка или список строк (по одной на чип цепочки)
      const raw = cfg.color_order ?? (kind === 'neopixel' ? 'GRB' : 'RGBW');
      const orders = Array.isArray(raw) ? raw : [raw];
      return orders.some((o) => typeof o === 'string' && o.toUpperCase().includes('W'));
    }
  }
}

function chainCount(kind: LedKind, cfg: Record<string, unknown>): number {
  if (kind !== 'neopixel' && kind !== 'dotstar') return 1;
  const n = Number(cfg.chain_count ?? 1);
  return Number.isInteger(n) && n > 0 ? n : 1;
}

export function parseLedItems(objects: readonly string[], settings: Record<string, any>): LedItem[] {
  const out: LedItem[] = [];
  for (const obj of objects) {
    const sp = obj.indexOf(' ');
    if (sp < 0) continue;
    const kind = obj.slice(0, sp) as LedKind;
    if (!LED_KINDS.includes(kind)) continue;
    const name = obj.slice(sp + 1);
    // ключи configfile.settings — в нижнем регистре
    const cfg = (settings[obj.toLowerCase()] ?? {}) as Record<string, unknown>;
    out.push({
      id: obj,
      kind,
      name,
      label: prettify(name),
      count: chainCount(kind, cfg),
      hasWhite: hasWhiteChannel(kind, cfg),
    });
  }
  return out;
}

export function parseTemplates(settings: Record<string, any>): LedTemplate[] {
  const out: LedTemplate[] = [];
  for (const [key, cfg] of Object.entries(settings)) {
    if (!key.startsWith('display_template ')) continue;
    const params: Record<string, string> = {};
    for (const [k, v] of Object.entries((cfg ?? {}) as Record<string, unknown>)) {
      if (k.startsWith('param_')) params[k.slice('param_'.length)] = String(v);
    }
    out.push({
      name: key.slice('display_template '.length),
      text: typeof cfg?.text === 'string' ? cfg.text : '',
      params,
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Значение параметра G-code. Klipper разбирает аргументы через shlex.split,
 * поэтому пробелы и кавычки допустимы внутри двойных кавычек.
 */
export function gcodeValue(v: string): string {
  if (/^[^\s"'\\]+$/.test(v)) return v;
  return `"${v.replace(/(["\\])/g, '\\$1')}"`;
}

function fmt(v: number): string {
  const c = Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
  return String(Math.round(c * 1000) / 1000);
}

/** Индексы 0-based → 1-based INDEX; null = вся цепочка (без INDEX). */
function targets(item: LedItem, indices: readonly number[] | null | undefined): Array<number | null> {
  if (!indices || indices.length === 0) return [null];
  const uniq = [...new Set(indices)].filter((i) => Number.isInteger(i) && i >= 0 && i < item.count);
  if (uniq.length === 0 || uniq.length === item.count) return [null];
  return uniq.sort((a, b) => a - b).map((i) => i + 1);
}

/**
 * SET_LED для выбранных пикселей. Несколько пикселей → несколько строк,
 * передача в ленту только на последней (TRANSMIT=1).
 */
export function buildSetLed(item: LedItem, color: Rgbw, indices?: readonly number[] | null): string {
  const t = targets(item, indices);
  const [r, g, b, w] = color;
  const base =
    `SET_LED LED=${gcodeValue(item.name)} RED=${fmt(r)} GREEN=${fmt(g)} BLUE=${fmt(b)}` +
    (item.hasWhite ? ` WHITE=${fmt(w)}` : '');
  return t
    .map((idx, i) => {
      if (idx === null) return base;
      return `${base} INDEX=${idx} TRANSMIT=${i === t.length - 1 ? 1 : 0}`;
    })
    .join('\n');
}

/** SET_LED_TEMPLATE; template = null снимает шаблон. */
export function buildSetTemplate(
  item: LedItem,
  template: string | null,
  params: Record<string, string>,
  indices?: readonly number[] | null,
): string {
  const t = targets(item, indices);
  let base = `SET_LED_TEMPLATE LED=${gcodeValue(item.name)} TEMPLATE=${template ? gcodeValue(template) : ''}`;
  if (template) {
    for (const [k, v] of Object.entries(params)) {
      if (v.trim() === '') continue;
      base += ` PARAM_${k.toUpperCase()}=${gcodeValue(v.trim())}`;
    }
  }
  return t.map((idx) => (idx === null ? base : `${base} INDEX=${idx}`)).join('\n');
}

/** Нормализация color_data из статуса: массив [r,g,b,w] на пиксель. */
export function parseColorData(raw: unknown, count: number): Rgbw[] {
  const out: Rgbw[] = [];
  const arr = Array.isArray(raw) ? raw : [];
  for (let i = 0; i < count; i++) {
    const px = Array.isArray(arr[i]) ? arr[i] : [];
    const ch = (k: number) => {
      const v = Number(px[k]);
      return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
    };
    out.push([ch(0), ch(1), ch(2), ch(3)]);
  }
  return out;
}

export function isLit(c: Rgbw): boolean {
  return c.some((v) => v > 0.001);
}

/** Цвет пикселя для превью: белый канал подмешивается к RGB. */
export function colorToCss(c: Rgbw): string {
  const [r, g, b, w] = c;
  const ch = (v: number) => Math.round(Math.min(1, v + w) * 255);
  return `rgb(${ch(r)}, ${ch(g)}, ${ch(b)})`;
}

export function rgbwToHex(c: Rgbw): string {
  const h = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0');
  return `#${h(c[0])}${h(c[1])}${h(c[2])}`;
}

export function hexToRgbw(hex: string, white = 0): Rgbw | null {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return null;
  return [parseInt(m[1]!, 16) / 255, parseInt(m[2]!, 16) / 255, parseInt(m[3]!, 16) / 255, white];
}

/** Яркость = максимум каналов (0..1). */
export function brightnessOf(c: Rgbw): number {
  return Math.max(...c);
}

/** Масштабировать цвет к заданной яркости; у погашенного — белый нужной яркости. */
export function withBrightness(c: Rgbw, level: number, hasWhite: boolean): Rgbw {
  const cur = brightnessOf(c);
  const l = Math.min(1, Math.max(0, level));
  if (cur <= 0.001) return hasWhite ? [0, 0, 0, l] : [l, l, l, 0];
  const k = l / cur;
  return [c[0] * k, c[1] * k, c[2] * k, c[3] * k];
}
