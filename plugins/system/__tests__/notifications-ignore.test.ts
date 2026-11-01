import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PluginApi, PluginSettingsApi } from '../../../plugin-sdk/src/types';
import { createAggregator } from '../use-notifications.svelte';

const KEY = 'system.notifications.ignoredPatterns';

/** Per-printer хранилища настроек, как при выключенном sync плагина. */
function fakeApi(printerIds: string[]) {
  const stores = new Map<string, Record<string, unknown>>(printerIds.map((id) => [id, {}]));
  let active = printerIds[0]!;

  const settingsOf = (id: () => string): PluginSettingsApi => ({
    get: <T,>(k: string) => stores.get(id())?.[k] as T | undefined,
    set: (k, v) => void (stores.get(id())![k] = v),
    onChange: () => () => {},
  });

  const api = {
    get printers() {
      return printerIds.map((id) => ({ id, name: id, url: '' }));
    },
    get printer() {
      return { id: active };
    },
    settings: settingsOf(() => active),
    settingsFor: (id: string) => settingsOf(() => id),
    onPrintersChange: () => () => {},
    onPrinterChange: () => () => {},
    moonrakerFor: () => {
      throw new Error('no moonraker in test');
    },
    i18n: { t: (k: string) => k, locale: 'en' },
  } as unknown as PluginApi;

  return { api, stores, switchTo: (id: string) => (active = id) };
}

const err = (text: string) => ({ severity: 'error' as const, source: 'tmc' as const, text, sticky: false });

let agg: ReturnType<typeof createAggregator> | null = null;

function setup(printerIds = ['p1']) {
  vi.stubGlobal('window', { addEventListener() {}, removeEventListener() {} });
  const f = fakeApi(printerIds);
  agg = createAggregator(f.api);
  agg.start();
  // items — модульный стейт и переживает тесты; сносим историю предыдущего теста
  agg.store.setIgnoredPatterns(['^']);
  agg.store.setIgnoredPatterns([]);
  return { ...f, agg };
}

afterEach(() => {
  agg?.store.setIgnoredPatterns([]);
  agg?.stop();
  agg = null;
  vi.unstubAllGlobals();
});

describe('ignored notification patterns', () => {
  it('drops a TMC notification matching a literal pattern', () => {
    const { agg } = setup();
    agg.store.setIgnoredPatterns(['TMC tmc2240 stepper_x1: ola']);
    agg.push('p1', err('TMC tmc2240 stepper_x1: ola'));
    agg.push('p1', err('TMC tmc2240 stepper_x1: olb'));
    expect(agg.store.items.map((n) => n.text)).toEqual(['TMC tmc2240 stepper_x1: olb']);
  });

  it('matches case-insensitively and anywhere in the text', () => {
    const { agg } = setup();
    agg.store.setIgnoredPatterns(['tmc\\d+ stepper_\\w+: ol[ab]']);
    agg.push('p1', err('TMC tmc2209 stepper_z1: OLA'));
    agg.push('p1', err('TMC tmc2240 stepper_x: olb'));
    expect(agg.store.items).toHaveLength(0);
  });

  it('survives an invalid regex without disabling the other patterns', () => {
    const { agg } = setup();
    agg.store.setIgnoredPatterns(['(', 'stepper_z']);
    agg.push('p1', err('TMC tmc2209 stepper_z: ola'));
    expect(agg.store.items).toHaveLength(0);
  });

  it('filters local notifications too (they bypass the source handlers)', () => {
    const { agg } = setup();
    agg.store.setIgnoredPatterns(['actionFailed']);
    agg.push('p1', { severity: 'error', source: 'plugin', text: 'system.errors.actionFailed', sticky: false });
    expect(agg.store.items).toHaveLength(0);
  });

  it('removes already-collected notifications when a pattern is added', () => {
    const { agg } = setup();
    agg.push('p1', err('TMC tmc2240 stepper_x1: ola'));
    agg.push('p1', err('TMC tmc2240 stepper_y: olb'));
    expect(agg.store.items).toHaveLength(2);

    agg.store.setIgnoredPatterns(['stepper_x1: ola']);
    expect(agg.store.items.map((n) => n.text)).toEqual(['TMC tmc2240 stepper_y: olb']);
  });

  it('ignoreText adds an exact, regex-escaped pattern once', () => {
    const { agg } = setup();
    const text = 'TMC tmc2240 stepper_x1: ola (a+b)';
    agg.push('p1', err(text));
    agg.store.ignoreText(text);
    agg.store.ignoreText(text);

    expect(agg.store.settings.ignoredPatterns).toHaveLength(1);
    expect(agg.store.items).toHaveLength(0);
    agg.push('p1', err(text));
    agg.push('p1', err(text + ' x'));
    expect(agg.store.items.map((n) => n.text)).toEqual([text + ' x']);
  });

  it('keeps patterns across printers: written to all, read as a union', () => {
    const { agg, stores, switchTo } = setup(['p1', 'p2']);
    agg.store.setIgnoredPatterns(['stepper_x1']);
    expect(stores.get('p1')![KEY]).toEqual(['stepper_x1']);
    expect(stores.get('p2')![KEY]).toEqual(['stepper_x1']);

    // «Старая» настройка, сохранённая на втором принтере до этого фикса
    stores.get('p2')![KEY] = ['stepper_x1', 'stepper_z'];
    switchTo('p2');
    agg.stop();
    agg.start();
    expect(agg.store.settings.ignoredPatterns).toEqual(['stepper_x1', 'stepper_z']);

    agg.push('p1', err('TMC tmc2209 stepper_z: ola'));
    expect(agg.store.items).toHaveLength(0);
  });

  it('removing a pattern removes it everywhere', () => {
    const { agg, stores } = setup(['p1', 'p2']);
    agg.store.setIgnoredPatterns(['a', 'b']);
    agg.store.setIgnoredPatterns(['b']);
    expect(stores.get('p1')![KEY]).toEqual(['b']);
    expect(stores.get('p2')![KEY]).toEqual(['b']);
    expect(agg.store.settings.ignoredPatterns).toEqual(['b']);
  });
});
