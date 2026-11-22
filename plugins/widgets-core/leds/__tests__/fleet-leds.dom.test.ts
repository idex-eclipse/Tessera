import { flushSync, mount, unmount } from 'svelte';
import { describe, expect, it, vi } from 'vitest';

import type { PluginApi } from '../../../../plugin-sdk/src/types';
import type { LedItem, Rgbw } from '../lib/led-data';
import LedsFleetPanel from '../components/fleet/LedsFleetPanel.svelte';

// Mutable fixture backing the mocked LED store; reset in every setup().
const state = vi.hoisted(() => ({
  items: [] as LedItem[],
  colors: {} as Record<string, Rgbw[]>,
  toggle: null as null | ReturnType<typeof vi.fn>,
}));

vi.mock('../../../../plugin-sdk/src/svelte/index', async () => ({
  useWidget: () => null,
  useI18n: () => ({ t: (key: string) => key }),
  // SliderField (inside LedControls) renders an ExtensionPoint; replace it with a stub.
  ExtensionPoint: (await import('./ext-point-stub.svelte')).default,
}));
vi.mock('../data/use-leds.svelte.ts', () => ({
  useLeds: vi.fn(() => ({
    get items() { return state.items; },
    get colors() { return state.colors; },
    templates: [],
    visibleTemplates: [],
    assignedTemplate: () => null,
    toggle: (...args: unknown[]) => state.toggle?.(...args),
    setColor: vi.fn(),
    setTemplate: vi.fn(),
  })),
}));
vi.mock('../../../shared/klippy-state/use-klippy-state.svelte', () => ({
  useKlippyState: () => ({ ready: true }),
}));

import { useLeds } from '../data/use-leds.svelte.ts';

function item(id: string, kind: LedItem['kind'], count: number, hasWhite = false): LedItem {
  return { id, kind, name: id.slice(id.indexOf(' ') + 1), label: id, count, hasWhite };
}

/** Mount a card whose active printer differs from the card's target printer. */
function setup(items: LedItem[], colors: Record<string, Rgbw[]>) {
  state.items = items;
  state.colors = colors;
  state.toggle = vi.fn();
  const api = {
    printer: { id: 'active' },
    moonrakerFor: vi.fn(),
  } as unknown as PluginApi;
  const target = document.createElement('div');
  document.body.appendChild(target);
  const component = mount(LedsFleetPanel, { target, props: { mpuApi: api, mpuParams: { printerId: 'target' } } });
  flushSync();
  return { target, stop: () => { unmount(component); target.remove(); } };
}

describe('fleet leds panel', () => {
  it('binds the LED store to the card printer, not the active one', () => {
    const view = setup([item('neopixel case', 'neopixel', 3)], {});
    try {
      expect(useLeds).toHaveBeenCalledWith(expect.anything(), 'target');
      expect(view.target.querySelector('.fleet-leds-button')).not.toBeNull();
    } finally { view.stop(); }
  });

  it('shows the off bulb when nothing is lit and the lit bulb when any pixel is on', () => {
    const off = setup([item('neopixel case', 'neopixel', 3)], {
      'neopixel case': [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]],
    });
    try {
      expect(off.target.querySelector('.fleet-leds-button.lit')).toBeNull();
    } finally { off.stop(); }

    const on = setup([item('neopixel case', 'neopixel', 3)], {
      'neopixel case': [[0, 0, 0, 0], [1, 1, 1, 0], [0, 0, 0, 0]],
    });
    try {
      expect(on.target.querySelector('.fleet-leds-button.lit')).not.toBeNull();
    } finally { on.stop(); }
  });

  it('opens the popover with one section per LED and toggles through the store', () => {
    const view = setup(
      [item('neopixel case', 'neopixel', 3), item('led chamber', 'led', 1, true)],
      {},
    );
    try {
      (view.target.querySelector('.fleet-leds-button') as HTMLButtonElement).click();
      flushSync();
      expect(view.target.querySelectorAll('.leds-popover .led')).toHaveLength(2);
      const power = view.target.querySelectorAll('.leds-popover .power')[0] as HTMLButtonElement;
      power.click();
      expect(state.toggle).toHaveBeenCalledWith('neopixel case');
    } finally { view.stop(); }
  });

  it('shows the empty note when the printer has no LEDs', () => {
    const view = setup([], {});
    try {
      (view.target.querySelector('.fleet-leds-button') as HTMLButtonElement).click();
      flushSync();
      expect(view.target.querySelector('.leds-popover .empty')?.textContent).toBe('fleet.leds.empty');
    } finally { view.stop(); }
  });
});
