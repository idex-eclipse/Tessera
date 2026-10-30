import { describe, expect, it } from 'vitest';

import type { FleetTag } from '../../../../plugin-sdk/src/types';

import { createFleetIndex } from '../fleet-index.svelte.ts';

const PRINTING: FleetTag = { id: 'printing', labelKey: 'k.printing', icon: 'print', order: 0 };
const IDLE: FleetTag = { id: 'idle', labelKey: 'k.idle', order: 1 };

describe('fleet-index', () => {
  it('returns null for a printer nobody published for', () => {
    expect(createFleetIndex().forPrinter('a')).toBeNull();
  });

  it('publish replaces the previous record of the same (plugin, printer)', () => {
    const idx = createFleetIndex();
    idx.publish('p1', 'a', { tags: [PRINTING], searchText: 'benchy.gcode' });
    idx.publish('p1', 'a', { tags: [IDLE], searchText: '' });

    expect(idx.forPrinter('a')).toEqual({ tags: [IDLE], searchText: '' });
  });

  it('merges records of several plugins for one printer, deduping tags by id', () => {
    const idx = createFleetIndex();
    idx.publish('p1', 'a', { tags: [PRINTING], searchText: 'one' });
    idx.publish('p2', 'a', { tags: [PRINTING, IDLE], searchText: 'two' });

    const merged = idx.forPrinter('a')!;
    expect(merged.tags.map((t) => t.id)).toEqual(['printing', 'idle']);
    expect(merged.searchText).toBe('one\ntwo');
  });

  it('retract removes only that plugin record, and the printer when it was the last', () => {
    const idx = createFleetIndex();
    idx.publish('p1', 'a', { tags: [PRINTING], searchText: '' });
    idx.publish('p2', 'a', { tags: [IDLE], searchText: '' });

    idx.retract('p1', 'a');
    expect(idx.forPrinter('a')!.tags.map((t) => t.id)).toEqual(['idle']);

    idx.retract('p2', 'a');
    expect(idx.forPrinter('a')).toBeNull();
  });

  it('retract of an unknown record is a no-op', () => {
    const idx = createFleetIndex();
    expect(() => idx.retract('p1', 'nope')).not.toThrow();
  });

  it('prune drops printers that are no longer configured', () => {
    const idx = createFleetIndex();
    idx.publish('p1', 'a', { tags: [PRINTING], searchText: '' });
    idx.publish('p1', 'b', { tags: [IDLE], searchText: '' });

    idx.prune(['b']);

    expect(idx.forPrinter('a')).toBeNull();
    expect(idx.forPrinter('b')).not.toBeNull();
  });

  it('does not replace the stored record when the published content is unchanged', () => {
    const idx = createFleetIndex();
    idx.publish('p1', 'a', { tags: [PRINTING], searchText: 'x' });
    const storedTag = idx.forPrinter('a')!.tags[0];

    // тот же контент (другой объект) — запись не заменяется, остаётся прежний тег
    idx.publish('p1', 'a', { tags: [{ ...PRINTING }], searchText: 'x' });
    expect(idx.forPrinter('a')!.tags[0]).toBe(storedTag);

    // изменённый контент — заменяется
    idx.publish('p1', 'a', { tags: [{ ...PRINTING }], searchText: 'y' });
    expect(idx.forPrinter('a')!.tags[0]).not.toBe(storedTag);
    expect(idx.forPrinter('a')!.searchText).toBe('y');
  });

  it('sanitizes: drops malformed tags and duplicates, caps tag count and text length', () => {
    const idx = createFleetIndex();
    const many = Array.from({ length: 40 }, (_, i) => ({ id: `t${i}`, labelKey: `k${i}` }));
    idx.publish('p1', 'a', {
      tags: [
        PRINTING,
        PRINTING,
        { id: '', labelKey: 'x' },
        { id: 'no-label' } as unknown as FleetTag,
        ...many,
      ],
      searchText: 'x'.repeat(5000),
    });

    const entry = idx.forPrinter('a')!;
    expect(entry.tags).toHaveLength(16);
    expect(entry.tags[0]!.id).toBe('printing');
    expect(entry.searchText).toHaveLength(512);
  });

  it('tolerates a missing tags array and a non-string searchText', () => {
    const idx = createFleetIndex();
    idx.publish('p1', 'a', { searchText: 42 } as unknown as never);

    expect(idx.forPrinter('a')).toEqual({ tags: [], searchText: '' });
  });
});
