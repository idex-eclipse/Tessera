/**
 * Цвета подсветки klipper-конфигов: токены, дефолты по темам хоста и (де)сериализация
 * пользовательских значений. Чистая логика без DOM — реактивная обёртка над
 * localStorage лежит в highlight-colors.svelte.ts.
 *
 * Цвета доходят до разметки через CSS-переменные --tok-<key>: диалог выставляет их
 * инлайн-стилем на оверлее, а правила .tok-* читают только var(--tok-*).
 */

export type ThemeName = 'light' | 'dark';

export const TOKEN_KEYS = [
  'section',
  'driver',
  'pin',
  'num',
  'comment',
  'save-mark',
  'cmd',
  'ext',
  'axis',
  'param',
  'str',
  'jinja',
  'jinja-kw',
  'jinja-var',
  'filter',
] as const;

export type TokKey = (typeof TOKEN_KEYS)[number];
export type ColorMap = Partial<Record<TokKey, string>>;

export interface StoredColors {
  v: 1;
  light: ColorMap;
  dark: ColorMap;
}

/** Общий для всех плагинов ключ (mpu:v2:* входит в экспорт/импорт настроек хоста). */
export const STORAGE_KEY = 'mpu:v2:editor-colors';

export const DEFAULT_COLORS: Record<ThemeName, Record<TokKey, string>> = {
  dark: {
    section: '#e8a15c',
    driver: '#56b6c2',
    pin: '#61afef',
    num: '#d19a66',
    comment: '#7f848e',
    'save-mark': '#c678dd',
    cmd: '#e06c75',
    ext: '#e8a15c',
    axis: '#e06c75',
    param: '#c850d8',
    str: '#c678dd',
    jinja: '#56b6c2',
    'jinja-kw': '#c678dd',
    'jinja-var': '#91df6d',
    filter: '#98c379',
  },
  light: {
    section: '#b5651d',
    driver: '#0184bc',
    pin: '#4078f2',
    num: '#986801',
    comment: '#7a8190',
    'save-mark': '#a626a4',
    cmd: '#e45649',
    ext: '#b86e00',
    axis: '#e45649',
    param: '#9c27b0',
    str: '#a626a4',
    jinja: '#0184bc',
    'jinja-kw': '#a626a4',
    'jinja-var': '#2e7d32',
    filter: '#3f8f3a',
  },
};

const HEX_RE = /^#[0-9a-f]{6}$/i;

/** '#ABCDEF' → '#abcdef'; всё остальное → null (как валидация accent в хосте). */
export function normalizeHex(value: unknown): string | null {
  return typeof value === 'string' && HEX_RE.test(value) ? value.toLowerCase() : null;
}

function sanitizeMap(raw: unknown): ColorMap {
  const out: ColorMap = {};
  if (!raw || typeof raw !== 'object') return out;
  const src = raw as Record<string, unknown>;
  for (const key of TOKEN_KEYS) {
    const hex = normalizeHex(src[key]);
    if (hex) out[key] = hex;
  }
  return out;
}

export function emptyColors(): StoredColors {
  return { v: 1, light: {}, dark: {} };
}

/** Разбирает значение из localStorage; битые данные и неизвестные ключи отбрасываются. */
export function parseColors(raw: string | null): StoredColors {
  if (!raw) return emptyColors();
  try {
    const obj = JSON.parse(raw) as Record<string, unknown> | null;
    if (!obj || typeof obj !== 'object') return emptyColors();
    return { v: 1, light: sanitizeMap(obj.light), dark: sanitizeMap(obj.dark) };
  } catch {
    return emptyColors();
  }
}

/** Возвращает копию с изменённым токеном; hex=null (или невалидный) сбрасывает токен. */
export function withColor(
  data: StoredColors,
  theme: ThemeName,
  key: TokKey,
  hex: string | null,
): StoredColors {
  const next: ColorMap = { ...data[theme] };
  const norm = normalizeHex(hex);
  if (norm) next[key] = norm;
  else delete next[key];
  return { ...data, [theme]: next };
}

export function withoutTheme(data: StoredColors, theme: ThemeName): StoredColors {
  return { ...data, [theme]: {} };
}

/** Итоговый цвет токена: пользовательский или дефолт темы. */
export function effectiveColor(theme: ThemeName, overrides: ColorMap, key: TokKey): string {
  return overrides[key] ?? DEFAULT_COLORS[theme][key];
}

/** Значение атрибута style для оверлея: все --tok-* активной темы. */
export function toStyle(theme: ThemeName, overrides: ColorMap): string {
  return TOKEN_KEYS.map((key) => `--tok-${key}:${effectiveColor(theme, overrides, key)}`).join(';');
}
