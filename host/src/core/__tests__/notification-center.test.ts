import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MemoryStorage } from '../storage';
import { createSettingsStore, SETTINGS_STORAGE_KEYS } from '../settings-store.svelte.ts';
import {
  createNotificationCenter,
  DEDUP_MS,
  HISTORY_CAP,
  LABEL_MAX,
  TEXT_MAX,
  TOAST_CAP,
  type NotificationPush,
} from '../notification-center.svelte.ts';

function setup() {
  const storage = new MemoryStorage();
  const settings = createSettingsStore({ storage });
  const center = createNotificationCenter(settings);
  return { storage, settings, center };
}

const n = (text: string, extra: Partial<NotificationPush> = {}): NotificationPush => ({
  printerId: 'p1',
  pluginId: '@core/system',
  severity: 'error',
  text,
  ...extra,
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('notification center / ignored patterns', () => {
  it('drops a notification matching a literal pattern', () => {
    const { center } = setup();
    center.setIgnoredPatterns(['TMC tmc2240 stepper_x1: ola']);
    center.push(n('TMC tmc2240 stepper_x1: ola'));
    center.push(n('TMC tmc2240 stepper_x1: olb'));
    expect(center.items.map((i) => i.text)).toEqual(['TMC tmc2240 stepper_x1: olb']);
  });

  it('matches case-insensitively and anywhere in the text', () => {
    const { center } = setup();
    center.setIgnoredPatterns(['tmc\\d+ stepper_\\w+: ol[ab]']);
    center.push(n('TMC tmc2209 stepper_z1: OLA'));
    center.push(n('TMC tmc2240 stepper_x: olb'));
    expect(center.items).toHaveLength(0);
  });

  it('survives an invalid regex without disabling the other patterns', () => {
    const { center } = setup();
    center.setIgnoredPatterns(['(', 'stepper_z']);
    center.push(n('TMC tmc2209 stepper_z: ola'));
    expect(center.items).toHaveLength(0);
  });

  it('filters every author alike, plugins and the host', () => {
    const { center } = setup();
    center.setIgnoredPatterns(['actionFailed']);
    center.push(n('system.errors.actionFailed'));
    center.push(n('actionFailed', { pluginId: '@host' }));
    expect(center.items).toHaveLength(0);
  });

  it('removes already-collected notifications when a pattern is added', () => {
    const { center } = setup();
    center.push(n('TMC tmc2240 stepper_x1: ola'));
    center.push(n('TMC tmc2240 stepper_y: olb'));
    expect(center.items).toHaveLength(2);

    center.setIgnoredPatterns(['stepper_x1: ola']);
    expect(center.items.map((i) => i.text)).toEqual(['TMC tmc2240 stepper_y: olb']);
  });

  it('ignoreText adds an exact, regex-escaped pattern once', () => {
    const { center } = setup();
    const text = 'TMC tmc2240 stepper_x1: ola (a+b)';
    center.push(n(text));
    center.ignoreText(text);
    center.ignoreText(text);

    expect(center.ignoredPatterns).toHaveLength(1);
    expect(center.items).toHaveLength(0);
    center.push(n(text));
    center.push(n(text + ' x'));
    expect(center.items.map((i) => i.text)).toEqual([text + ' x']);
  });

  it('keeps the patterns and the sound flag across reloads', () => {
    const { storage, center } = setup();
    center.setIgnoredPatterns(['a', 'b']);
    center.setSoundEnabled(true);

    const reloaded = createNotificationCenter(createSettingsStore({ storage }));
    expect(reloaded.ignoredPatterns).toEqual(['a', 'b']);
    expect(reloaded.soundEnabled).toBe(true);
  });

  it('falls back to defaults when the stored settings are malformed', () => {
    const storage = new MemoryStorage();
    storage.setItem(
      SETTINGS_STORAGE_KEYS.ui,
      JSON.stringify({ notifications: { ignoredPatterns: [1, 2], soundEnabled: 'yes' } }),
    );
    const center = createNotificationCenter(createSettingsStore({ storage }));
    expect(center.ignoredPatterns).toEqual([]);
    expect(center.soundEnabled).toBe(false);
  });
});

describe('notification center / history', () => {
  it('stores the author, the label and trims them', () => {
    const { center } = setup();
    center.push(n('  hot  ', { label: '  TMC  ', pluginId: '@core/calibrations' }));
    expect(center.items[0]).toMatchObject({
      text: 'hot',
      label: 'TMC',
      pluginId: '@core/calibrations',
      printerId: 'p1',
      seen: false,
      dismissed: false,
    });
  });

  it('drops empty text and unknown severities', () => {
    const { center } = setup();
    center.push(n('   '));
    center.push({ ...n('x'), severity: 'fatal' as never });
    expect(center.items).toHaveLength(0);
  });

  it('flattens newlines and truncates long text and labels', () => {
    const { center } = setup();
    center.push(n('a\nb\r\nc'));
    center.push(n('x'.repeat(TEXT_MAX + 50), { label: 'L'.repeat(LABEL_MAX + 10) }));
    const [long, flat] = center.items;
    expect(flat!.text).toBe('a b c');
    expect(long!.text).toHaveLength(TEXT_MAX);
    expect(long!.text.endsWith('…')).toBe(true);
    expect(long!.label).toHaveLength(LABEL_MAX);
  });

  it('deduplicates the same text from the same author within the window only', () => {
    const { center } = setup();
    center.push(n('Heater  stuck'));
    center.push(n('heater stuck'));
    expect(center.items).toHaveLength(1);

    center.push(n('heater stuck', { pluginId: '@core/other' }));
    center.push(n('heater stuck', { printerId: 'p2' }));
    expect(center.items).toHaveLength(3);

    vi.advanceTimersByTime(DEDUP_MS + 1);
    center.push(n('heater stuck'));
    expect(center.items).toHaveLength(4);
  });

  it('keeps the newest HISTORY_CAP items, newest first', () => {
    const { center } = setup();
    for (let i = 0; i < HISTORY_CAP + 5; i++) center.push(n(`m${i}`));
    expect(center.items).toHaveLength(HISTORY_CAP);
    expect(center.items[0]!.text).toBe(`m${HISTORY_CAP + 4}`);
  });

  it('shows at most TOAST_CAP undismissed toasts', () => {
    const { center } = setup();
    for (let i = 0; i < TOAST_CAP + 3; i++) center.push(n(`m${i}`));
    expect(center.activeToasts).toHaveLength(TOAST_CAP);

    const top = center.activeToasts[0]!;
    center.dismiss(top.id);
    expect(center.activeToasts.some((t) => t.id === top.id)).toBe(false);
    expect(center.items.find((t) => t.id === top.id)).toMatchObject({ dismissed: true, seen: true });
  });

  it('counts unseen items; markSeen, dismiss and dismissAll clear them', () => {
    const { center } = setup();
    center.push(n('a'));
    center.push(n('b'));
    center.push(n('c'));
    expect(center.unseenCount).toBe(3);

    center.markSeen(center.items[0]!.id);
    expect(center.unseenCount).toBe(2);
    expect(center.activeToasts).toHaveLength(3);

    center.dismiss(center.items[1]!.id);
    expect(center.unseenCount).toBe(1);

    center.dismissAll();
    expect(center.unseenCount).toBe(0);
    expect(center.activeToasts).toHaveLength(0);
    expect(center.items).toHaveLength(3);
  });

  it('toggle and setOpen drive the panel state', () => {
    const { center } = setup();
    expect(center.open).toBe(false);
    center.toggle();
    expect(center.open).toBe(true);
    center.setOpen(false);
    expect(center.open).toBe(false);
  });
});
