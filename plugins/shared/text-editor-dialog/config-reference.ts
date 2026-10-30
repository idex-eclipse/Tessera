/**
 * Справка по секциям конфига из Klipper docs/Config_Reference.md.
 *
 * Чистая логика без DOM: разбор документа в индекс заголовков, подбор фрагмента под
 * секцию пользователя и поиск секции по позиции в тексте редактора.
 *
 * Формат документа: `## Группа`, `### [секция]` (заголовок — тип без имени:
 * `[stepper]`, `[tmc2209]`, `[gcode_macro]`), `#### Подраздел`. Внутри ограждений ```
 * лежат примеры конфига, где строки `# …` — комментарии, а не заголовки.
 */

import type { Block } from './mini-markdown';

export interface SectionEntry {
  /** текст внутри скобок заголовка: `mcu my_extra_mcu` */
  heading: string;
  /** индекс строки заголовка */
  line: number;
  /** индекс строки, с которой фрагмент уже закончился (не включая её) */
  end: number;
}

export interface ReferenceIndex {
  lines: string[];
  byKey: Map<string, SectionEntry>;
  byType: Map<string, SectionEntry>;
}

export interface Fragment {
  heading: string;
  /** строки под заголовком, без хвостовых пустых */
  body: string[];
}

/** Что показывает popover справки. */
export type HelpView =
  | { status: 'loading' }
  | { status: 'ready'; fragment: Fragment; blocks: Block[] }
  | { status: 'notFound' }
  | { status: 'unavailable' }
  | { status: 'error'; message: string };

const FENCE_RE = /^\s*```/;
const HEADING_RE = /^(#{2,4}) (.*)$/;
const SECTION_RE = /^\[([^\]]+)\]/;

function normalizeKey(s: string): string {
  return s.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function parseReference(text: string): ReferenceIndex {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');

  interface Head {
    line: number;
    level: number;
    text: string;
  }
  const heads: Head[] = [];
  let fenced = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i] ?? '';
    if (FENCE_RE.test(l)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const m = HEADING_RE.exec(l);
    if (m) heads.push({ line: i, level: (m[1] ?? '').length, text: (m[2] ?? '').trim() });
  }

  const byKey = new Map<string, SectionEntry>();
  const byType = new Map<string, SectionEntry>();

  for (let h = 0; h < heads.length; h++) {
    const head = heads[h];
    if (!head || head.level !== 3) continue;
    const m = SECTION_RE.exec(head.text);
    if (!m) continue;

    // фрагмент идёт до следующего заголовка уровня ≤ 3; `####` остаются внутри
    let end = lines.length;
    for (let j = h + 1; j < heads.length; j++) {
      const next = heads[j];
      if (next && next.level <= 3) {
        end = next.line;
        break;
      }
    }

    const heading = (m[1] ?? '').trim().replace(/\s+/g, ' ');
    const entry: SectionEntry = { heading, line: head.line, end };
    const key = normalizeKey(heading);
    const type = key.split(' ')[0] ?? '';
    // у mcu и display по два заголовка — выигрывает первый (без имени-примера)
    if (!byKey.has(key)) byKey.set(key, entry);
    if (type && !byType.has(type)) byType.set(type, entry);
  }

  return { lines, byKey, byType };
}

function lookupType(index: ReferenceIndex, type: string): SectionEntry | undefined {
  const direct = index.byType.get(type);
  if (direct) return direct;

  // extruder3 → extruder1 → extruder; stepper_z2 → stepper_z1
  const num = /^(.*\D)(\d+)$/.exec(type);
  if (num) {
    const base = num[1] ?? '';
    return index.byType.get(`${base}1`) ?? lookupType(index, base);
  }

  // stepper_x / stepper_y / stepper_a …: отдельных заголовков нет, всё описано в [stepper]
  if (/^stepper_[a-z]$/.test(type)) return index.byType.get('stepper');
  return undefined;
}

/** Фрагмент справки под секцию конфига (текст внутри скобок), или null. */
export function resolveSection(index: ReferenceIndex, header: string): Fragment | null {
  const key = normalizeKey(header);
  if (!key) return null;
  const entry = index.byKey.get(key) ?? lookupType(index, key.split(' ')[0] ?? '');
  if (!entry) return null;

  const body = index.lines.slice(entry.line + 1, entry.end);
  while (body.length > 0 && (body[body.length - 1] ?? '').trim() === '') body.pop();
  while (body.length > 0 && (body[0] ?? '').trim() === '') body.shift();
  return { heading: entry.heading, body };
}

// ----------------------------------------------------------------------
// Поиск секции в тексте редактора
// ----------------------------------------------------------------------

const HEADER_LINE_RE = /^(\s*)\[([^\]]+)\]/;

export interface HeaderHit {
  name: string;
  /** индекс начала строки в тексте */
  lineStart: number;
}

function lineStartOf(text: string, idx: number): number {
  return idx > 0 ? text.lastIndexOf('\n', idx - 1) + 1 : 0;
}

function lineEndOf(text: string, from: number): number {
  const nl = text.indexOf('\n', from);
  return nl === -1 ? text.length : nl;
}

/** Разбор строки-заголовка: имя и границы `[…]` в строке. */
export function parseHeaderLine(
  line: string,
): { name: string; from: number; to: number } | null {
  const m = HEADER_LINE_RE.exec(line);
  if (!m) return null;
  const from = (m[1] ?? '').length;
  const to = from + (m[2] ?? '').length + 2;
  return { name: (m[2] ?? '').trim(), from, to };
}

/** Секция, если индекс стоит внутри `[…]` заголовочной строки (для Ctrl+клика). */
export function sectionInsideAt(text: string, idx: number): HeaderHit | null {
  const lineStart = lineStartOf(text, idx);
  const line = text.slice(lineStart, lineEndOf(text, lineStart));
  const hdr = parseHeaderLine(line);
  if (!hdr) return null;
  const col = idx - lineStart;
  return col >= hdr.from && col <= hdr.to ? { name: hdr.name, lineStart } : null;
}

/** Ближайший заголовок секции на строке каретки или выше (для F1 из любого места секции). */
export function sectionAbove(text: string, idx: number): HeaderHit | null {
  let lineStart = lineStartOf(text, idx);
  for (;;) {
    const hdr = parseHeaderLine(text.slice(lineStart, lineEndOf(text, lineStart)));
    if (hdr) return { name: hdr.name, lineStart };
    if (lineStart === 0) return null;
    lineStart = lineStartOf(text, lineStart - 1);
  }
}

// ----------------------------------------------------------------------
// Клик по слою подсветки (read-only: textarea нет, каретки тоже)
// ----------------------------------------------------------------------

export interface TextBox {
  left: number;
  top: number;
  scrollLeft: number;
  scrollTop: number;
  padL: number;
  padT: number;
  charW: number;
  lineH: number;
}

/** Точка экрана → строка и колонка текста (табуляция при подсчёте не учитывается). */
export function pointToCell(x: number, y: number, box: TextBox): { line: number; col: number } {
  const line = Math.floor((y - box.top - box.padT + box.scrollTop) / box.lineH);
  const col = Math.floor((x - box.left - box.padL + box.scrollLeft) / box.charW);
  return { line, col };
}

/** Секция, если ячейка (line, col) попала в `[…]` заголовочной строки. */
export function sectionAtCell(text: string, line: number, col: number): HeaderHit | null {
  if (line < 0 || col < 0) return null;
  let start = 0;
  for (let i = 0; i < line; i++) {
    const nl = text.indexOf('\n', start);
    if (nl === -1) return null;
    start = nl + 1;
  }
  const hdr = parseHeaderLine(text.slice(start, lineEndOf(text, start)));
  return hdr && col >= hdr.from && col < hdr.to ? { name: hdr.name, lineStart: start } : null;
}
