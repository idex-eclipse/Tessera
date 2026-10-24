import type { HotkeyContribution, HotkeyScope } from '../../../plugin-sdk/src/types';

/**
 * Hotkeys: чистая логика (без DOM-слушателей и Svelte).
 *
 * - parseCombo / formatCombo — разбор и нормализация записи "Ctrl+Shift+K";
 * - eventMatches — сопоставление KeyboardEvent с комбинацией;
 * - analyzeHotkeys — разрешение конфликтов: конфликтующие вклады отключаются оба.
 */

export interface Combo {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
  /** Нормализованная основная клавиша: 'k', '1', '/', 'f5', 'escape', 'arrowup'… */
  key: string;
}

export const HOTKEY_SCOPES: readonly HotkeyScope[] = ['global', 'dashboard', 'plugin'];

type ModifierName = 'ctrl' | 'alt' | 'shift' | 'meta';

/** macOS/iOS: Mod → Meta (Cmd), иначе Mod → Ctrl. */
export function detectMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent || '');
}

const MODIFIER_ALIASES: Record<string, ModifierName> = {
  ctrl: 'ctrl',
  control: 'ctrl',
  alt: 'alt',
  option: 'alt',
  shift: 'shift',
  meta: 'meta',
  cmd: 'meta',
  command: 'meta',
  win: 'meta',
  super: 'meta',
};

const KEY_ALIASES: Record<string, string> = {
  esc: 'escape',
  return: 'enter',
  del: 'delete',
  up: 'arrowup',
  down: 'arrowdown',
  left: 'arrowleft',
  right: 'arrowright',
  plus: '+',
  slash: '/',
  backslash: '\\',
  comma: ',',
  period: '.',
  dot: '.',
  semicolon: ';',
  quote: "'",
  backquote: '`',
  minus: '-',
  equal: '=',
  space: ' ',
  spacebar: ' ',
};

/** KeyboardEvent.code → символ для знаков препинания (не зависит от раскладки). */
const CODE_TO_CHAR: Record<string, string> = {
  Slash: '/',
  Backslash: '\\',
  Comma: ',',
  Period: '.',
  Semicolon: ';',
  Quote: "'",
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
};

const MODIFIER_KEYS = new Set(['control', 'alt', 'shift', 'meta', 'altgraph', 'os']);

function normalizeKeyToken(token: string): string {
  const lower = token.toLowerCase();
  return KEY_ALIASES[lower] ?? lower;
}

/** Разбор "Ctrl+Shift+K"; null — запись некорректна (нет основной клавиши, дубль, мусор). */
export function parseCombo(spec: unknown, mac: boolean = detectMacPlatform()): Combo | null {
  if (typeof spec !== 'string') return null;
  let rest = spec.trim();
  if (!rest) return null;

  // "Ctrl++" / "+" → основная клавиша '+': отделяем хвостовой плюс.
  let key: string | null = null;
  if (rest === '+') {
    key = '+';
    rest = '';
  } else if (rest.endsWith('++')) {
    key = '+';
    rest = rest.slice(0, -2);
  }

  const parts = rest ? rest.split('+').map((p) => p.trim()) : [];
  const combo: Combo = { ctrl: false, alt: false, shift: false, meta: false, key: '' };

  for (const part of parts) {
    if (!part) return null;
    const lowered = part.toLowerCase();
    const mod = lowered === 'mod' ? (mac ? 'meta' : 'ctrl') : MODIFIER_ALIASES[lowered];
    if (mod) {
      if (combo[mod]) return null;
      combo[mod] = true;
      continue;
    }
    if (key !== null) return null;
    key = normalizeKeyToken(part);
  }

  if (key === null) return null;
  combo.key = key;
  return combo;
}

/** Каноничная строка комбинации (для сравнения и показа): "ctrl+shift+k". */
export function formatCombo(combo: Combo): string {
  const mods: string[] = [];
  if (combo.ctrl) mods.push('ctrl');
  if (combo.alt) mods.push('alt');
  if (combo.shift) mods.push('shift');
  if (combo.meta) mods.push('meta');
  return [...mods, combo.key === ' ' ? 'space' : combo.key].join('+');
}

/** Основная клавиша события в той же нормализации, что у parseCombo. */
export function eventKey(event: Pick<KeyboardEvent, 'code' | 'key'>): string {
  const code = event.code ?? '';
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return letter[1]!.toLowerCase();
  const digit = /^(?:Digit|Numpad)(\d)$/.exec(code);
  if (digit) return digit[1]!;
  const punct = CODE_TO_CHAR[code];
  if (punct) return punct;
  return normalizeKeyToken(event.key ?? '');
}

type KeyEventLike = Pick<
  KeyboardEvent,
  'code' | 'key' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'
>;

export function eventMatches(event: KeyEventLike, combo: Combo): boolean {
  if (MODIFIER_KEYS.has((event.key ?? '').toLowerCase())) return false;
  return (
    event.ctrlKey === combo.ctrl &&
    event.altKey === combo.alt &&
    event.shiftKey === combo.shift &&
    event.metaKey === combo.meta &&
    eventKey(event) === combo.key
  );
}

/** Есть ли у комбинации «командный» модификатор (такие допустимы в полях ввода). */
export function hasCommandModifier(combo: Combo): boolean {
  return combo.ctrl || combo.alt || combo.meta;
}

// ------------------------------------------------------------------
// Конфликты
// ------------------------------------------------------------------

export interface HotkeyEntry {
  pluginId: string;
  contribution: HotkeyContribution;
}

export interface HotkeyBinding extends HotkeyEntry {
  combo: Combo;
  /** Каноничная запись комбинации. */
  canonical: string;
  /** false — отключён из-за конфликта. */
  enabled: boolean;
}

export interface HotkeyConflict {
  canonical: string;
  /** Все участники конфликта (отключены все стороны). */
  members: Array<{ pluginId: string; id: string; scope: HotkeyScope }>;
}

export interface HotkeyAnalysis {
  bindings: HotkeyBinding[];
  conflicts: HotkeyConflict[];
  /** Вклады с некорректной записью keys (не активны). */
  invalid: HotkeyEntry[];
}

interface Member {
  pluginId: string;
  scope: HotkeyScope;
}

/**
 * Правила пересечения одной и той же комбинации:
 * - global ↔ любой: конфликт;
 * - dashboard ↔ dashboard: конфликт;
 * - dashboard ↔ plugin: допустимо;
 * - plugin ↔ plugin: допустимо у разных плагинов, у одного — конфликт.
 */
export function hotkeysConflict(a: Member, b: Member): boolean {
  if (a.scope === 'global' || b.scope === 'global') return true;
  if (a.scope === 'dashboard' && b.scope === 'dashboard') return true;
  if (a.scope === 'plugin' && b.scope === 'plugin') return a.pluginId === b.pluginId;
  return false;
}

interface Parsed extends HotkeyEntry {
  combo: Combo;
  canonical: string;
}

/**
 * Строит биндинги и находит конфликты. Отключаются ВСЕ стороны конфликта,
 * включая участника, который конфликтует лишь с одним из нескольких.
 */
export function analyzeHotkeys(
  entries: readonly HotkeyEntry[],
  mac: boolean = detectMacPlatform(),
): HotkeyAnalysis {
  const invalid: HotkeyEntry[] = [];
  const parsed: Parsed[] = [];

  for (const entry of entries) {
    const combo = parseCombo(entry.contribution.keys, mac);
    if (!combo) {
      invalid.push(entry);
      continue;
    }
    parsed.push({ ...entry, combo, canonical: formatCombo(combo) });
  }

  const byCombo = new Map<string, Parsed[]>();
  for (const item of parsed) {
    const list = byCombo.get(item.canonical);
    if (list) list.push(item);
    else byCombo.set(item.canonical, [item]);
  }

  const disabled = new Set<Parsed>();
  const conflicts: HotkeyConflict[] = [];

  for (const [canonical, group] of byCombo) {
    if (group.length < 2) continue;

    const involved = new Set<Parsed>();
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i]!;
        const b = group[j]!;
        const clash = hotkeysConflict(
          { pluginId: a.pluginId, scope: a.contribution.scope },
          { pluginId: b.pluginId, scope: b.contribution.scope },
        );
        if (clash) {
          involved.add(a);
          involved.add(b);
        }
      }
    }
    if (involved.size === 0) continue;

    for (const m of involved) disabled.add(m);
    conflicts.push({
      canonical,
      members: [...involved].map((m) => ({
        pluginId: m.pluginId,
        id: m.contribution.id,
        scope: m.contribution.scope,
      })),
    });
  }

  return {
    bindings: parsed.map((p) => ({ ...p, enabled: !disabled.has(p) })),
    conflicts,
    invalid,
  };
}
