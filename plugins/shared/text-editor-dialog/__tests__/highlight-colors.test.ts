import { describe, expect, it } from 'vitest';

import {
  DEFAULT_COLORS,
  TOKEN_KEYS,
  effectiveColor,
  emptyColors,
  normalizeHex,
  parseColors,
  toStyle,
  withColor,
  withoutTheme,
} from '../highlight-colors';

describe('normalizeHex', () => {
  it('принимает #rrggbb и приводит к нижнему регистру', () => {
    expect(normalizeHex('#ABCDEF')).toBe('#abcdef');
  });

  it('отвергает всё остальное', () => {
    for (const v of ['abcdef', '#abc', '#abcdeg', '#abcdef0', '', null, 12, undefined]) {
      expect(normalizeHex(v)).toBeNull();
    }
  });
});

describe('parseColors', () => {
  it('пустое и битое значение → пустой набор', () => {
    expect(parseColors(null)).toEqual(emptyColors());
    expect(parseColors('not json')).toEqual(emptyColors());
    expect(parseColors('42')).toEqual(emptyColors());
    expect(parseColors('null')).toEqual(emptyColors());
  });

  it('оставляет только известные токены с валидным hex', () => {
    const raw = JSON.stringify({
      v: 1,
      light: { pin: '#112233', num: 'red', unknown: '#ffffff' },
      dark: { section: '#AABBCC' },
    });
    expect(parseColors(raw)).toEqual({
      v: 1,
      light: { pin: '#112233' },
      dark: { section: '#aabbcc' },
    });
  });
});

describe('withColor / withoutTheme', () => {
  it('задаёт цвет только в своей теме и не мутирует исходник', () => {
    const base = emptyColors();
    const next = withColor(base, 'dark', 'pin', '#ABCDEF');
    expect(next.dark).toEqual({ pin: '#abcdef' });
    expect(next.light).toEqual({});
    expect(base.dark).toEqual({});
  });

  it('null и невалидный hex сбрасывают токен', () => {
    const set = withColor(emptyColors(), 'light', 'num', '#123456');
    expect(withColor(set, 'light', 'num', null).light).toEqual({});
    expect(withColor(set, 'light', 'num', 'oops').light).toEqual({});
  });

  it('withoutTheme чистит только выбранную тему', () => {
    let d = withColor(emptyColors(), 'light', 'num', '#123456');
    d = withColor(d, 'dark', 'num', '#654321');
    const r = withoutTheme(d, 'dark');
    expect(r.dark).toEqual({});
    expect(r.light).toEqual({ num: '#123456' });
  });
});

describe('toStyle / effectiveColor', () => {
  it('дефолты покрывают все токены в обеих темах', () => {
    for (const theme of ['light', 'dark'] as const) {
      for (const key of TOKEN_KEYS) {
        expect(normalizeHex(DEFAULT_COLORS[theme][key])).not.toBeNull();
      }
    }
  });

  it('пользовательское значение перекрывает дефолт', () => {
    expect(effectiveColor('dark', { pin: '#010203' }, 'pin')).toBe('#010203');
    expect(effectiveColor('dark', {}, 'pin')).toBe(DEFAULT_COLORS.dark.pin);
  });

  it('style содержит все 15 переменных --tok-*', () => {
    const style = toStyle('light', { 'jinja-var': '#010203' });
    expect(style.split(';')).toHaveLength(TOKEN_KEYS.length);
    expect(style).toContain('--tok-jinja-var:#010203');
    expect(style).toContain(`--tok-section:${DEFAULT_COLORS.light.section}`);
  });
});
