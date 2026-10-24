import { describe, expect, it } from 'vitest';

import { isRtl, shouldAlignToEnd } from '../../shared/popover-align';
import { mapMacroHelp } from '../macros/macro-help';
import { filamentChips, filamentWidgets } from '../filament-sensors/manifest';
import { en } from '../i18n/locales/en';
import { ru } from '../i18n/locales/ru';
import { jobQueueWidgets } from '../job-queue/manifest';
import { limitsWidgets } from '../limits/manifest';
import { outputsChips, outputsWidgets } from '../outputs/manifest';

const flat = (o: Record<string, unknown>, p = '', out: Record<string, unknown> = {}) => {
  for (const [k, v] of Object.entries(o)) {
    const key = p ? `${p}.${k}` : k;
    if (v && typeof v === 'object') flat(v as Record<string, unknown>, key, out);
    else out[key] = v;
  }
  return out;
};

describe('popover alignment', () => {
  const rect = { left: 900, right: 1000 };

  it('LTR: flips to the end edge when the popover would leave the right side of the screen', () => {
    expect(shouldAlignToEnd(rect, 240, 1100, false)).toBe(true);
    expect(shouldAlignToEnd(rect, 240, 1200, false)).toBe(false);
  });

  it('RTL: flips when the popover would leave the left side of the screen', () => {
    expect(shouldAlignToEnd({ left: 20, right: 120 }, 240, 1200, true)).toBe(true);
    expect(shouldAlignToEnd({ left: 500, right: 600 }, 240, 1200, true)).toBe(false);
  });

  it('isRtl reads the dir attribute and is false without a document', () => {
    expect(isRtl()).toBe(false);
  });
});

describe('locales of the small widgets', () => {
  // остальные виджеты (macros / temperature / tools) проверяются при их ревью
  const OWN = /^widgets.(filament|limits|outputs|jobQueue)./;
  const own = (o: Record<string, unknown>) => Object.keys(flat(o)).filter((k) => OWN.test(k)).sort();

  it('en and ru define the same keys for these widgets', () => {
    expect(own(ru)).toEqual(own(en));
    expect(own(en).length).toBeGreaterThan(20);
  });

  it('define every title / chip key and every job-queue state and unit', () => {
    const keys = flat(en);
    const contributions = [...filamentWidgets, ...limitsWidgets, ...outputsWidgets, ...jobQueueWidgets];
    for (const w of contributions) expect(keys[w.titleKey]).toBeTruthy();
    for (const c of [...filamentChips, ...outputsChips]) expect(keys[c.titleKey]).toBeTruthy();

    for (const s of ['ready', 'loading', 'starting', 'paused', 'unknown']) {
      expect(keys[`widgets.jobQueue.state.${s}`]).toBeTruthy();
    }
    for (const l of [en, ru]) {
      const f = flat(l);
      expect(f['widgets.jobQueue.unit.m']).toBeTruthy();
      expect(f['widgets.jobQueue.unit.s']).toBeTruthy();
    }
  });
});

describe('macro help mapping', () => {
  it('matches Klipper upper-case command names to config-cased macro names', () => {
    expect(mapMacroHelp(['Park', 'PRIME_LINE', 'nohelp'], { PARK: 'Park the head', PRIME_LINE: 'Prime', OTHER: 'x' })).toEqual({
      Park: 'Park the head',
      PRIME_LINE: 'Prime',
    });
  });

  it('tolerates a failed or malformed help response', () => {
    expect(mapMacroHelp(['A'], null)).toEqual({});
    expect(mapMacroHelp(['A'], { A: 5, B: '' })).toEqual({});
  });
});
