import { describe, expect, it } from 'vitest';

import type { FleetIndexEntry, FleetTag } from '../../../../plugin-sdk/src/types';

import { collectTags, matchPrinter } from '../fleet-filter';

const PRINTING: FleetTag = { id: 'printing', labelKey: 'k.printing', order: 0 };
const IDLE: FleetTag = { id: 'idle', labelKey: 'k.idle', order: 1 };
const ERROR: FleetTag = { id: 'klippy-error', labelKey: 'k.error', order: 2 };

const printer = { id: 'a', name: 'Voron 2.4' };
const printing: FleetIndexEntry = { tags: [PRINTING], searchText: 'Benchy_0.2mm.gcode' };
const none = new Set<string>();

describe('matchPrinter', () => {
  it('matches everything when there is no query and no active tags', () => {
    expect(matchPrinter(printer, null, '', none)).toBe(true);
    expect(matchPrinter(printer, printing, '   ', none)).toBe(true);
  });

  it('matches the printer name, case-insensitively, without any index', () => {
    expect(matchPrinter(printer, null, 'voron', none)).toBe(true);
    expect(matchPrinter(printer, null, 'VORON 2', none)).toBe(true);
    expect(matchPrinter(printer, null, 'prusa', none)).toBe(false);
  });

  it('matches the printing file name from searchText', () => {
    expect(matchPrinter(printer, printing, 'benchy', none)).toBe(true);
    expect(matchPrinter(printer, printing, '0.2MM.gcode', none)).toBe(true);
    expect(matchPrinter(printer, printing, 'cube', none)).toBe(false);
  });

  it('active tags are OR-ed', () => {
    expect(matchPrinter(printer, printing, '', new Set(['idle', 'printing']))).toBe(true);
    expect(matchPrinter(printer, printing, '', new Set(['idle']))).toBe(false);
  });

  it('a printer without an index never passes a tag filter', () => {
    expect(matchPrinter(printer, null, '', new Set(['idle']))).toBe(false);
  });

  it('query and tags are AND-ed', () => {
    expect(matchPrinter(printer, printing, 'benchy', new Set(['printing']))).toBe(true);
    expect(matchPrinter(printer, printing, 'benchy', new Set(['idle']))).toBe(false);
    expect(matchPrinter(printer, printing, 'cube', new Set(['printing']))).toBe(false);
  });
});

describe('collectTags', () => {
  it('counts printers per tag and sorts by order then id', () => {
    const result = collectTags([
      { tags: [IDLE], searchText: '' },
      { tags: [PRINTING], searchText: '' },
      { tags: [IDLE], searchText: '' },
      null,
      { tags: [ERROR], searchText: '' },
    ]);

    expect(result.map((r) => [r.tag.id, r.count])).toEqual([
      ['printing', 1],
      ['idle', 2],
      ['klippy-error', 1],
    ]);
  });

  it('is empty when nobody publishes', () => {
    expect(collectTags([null, null])).toEqual([]);
  });
});
