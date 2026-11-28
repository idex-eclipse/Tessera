import { flushSync, mount, unmount } from 'svelte';
import { describe, expect, it, vi } from 'vitest';

import type { LedItem, Rgbw } from '../lib/led-data';
import LedChip from '../components/chips/LedChip.svelte';

// The mutable fixture lets each mount model a different printer LED state.
const state = vi.hoisted(() => ({
  items: [] as LedItem[],
  colors: {} as Record<string, Rgbw[]>,
  toggleSelection: vi.fn(),
}));

vi.mock('../../../../plugin-sdk/src/svelte/index', async () => ({
  usePluginApi: () => ({ i18n: { t: (key: string) => key } }),
  // Sliders render an extension point, which needs a host context outside this test.
  ExtensionPoint: (await import('./ext-point-stub.svelte')).default,
}));
vi.mock('../data/use-leds.svelte.ts', () => ({
  useLeds: () => ({
    get items() { return state.items; },
    get colors() { return state.colors; },
    templates: [],
    visibleTemplates: [],
    assignedTemplate: () => null,
    toggleSelection: (...args: unknown[]) => state.toggleSelection(...args),
    setColor: vi.fn(),
    setTemplate: vi.fn(),
  }),
}));
vi.mock('../../../shared/klippy-state/use-klippy-state.svelte', () => ({
  useKlippyState: () => ({ state: 'ready', ready: true }),
}));

/** Mount one LED chip with a stable status snapshot. */
function setup(item: LedItem, pixels: Rgbw[]) {
  state.items = [item];
  state.colors = { [item.id]: pixels };
  state.toggleSelection.mockClear();
  const target = document.createElement('div');
  document.body.appendChild(target);
  const component = mount(LedChip, { target, props: { params: { chipId: item.id } } });
  flushSync();
  return { target, stop: () => { unmount(component); target.remove(); } };
}

describe('LED chip', () => {
  it('keeps All selection and toggles the selected pixels from the first preset', () => {
    const item: LedItem = { id: 'neopixel case', kind: 'neopixel', name: 'case', label: 'Case', count: 3, hasWhite: false };
    const view = setup(item, [[1, 0, 0, 0], [0, 0, 0, 0], [0, 0, 1, 0]]);
    try {
      const chip = view.target.querySelector('.chip') as HTMLButtonElement;
      expect(chip.tagName).toBe('BUTTON');
      chip.click();
      flushSync();

      expect(view.target.querySelector('.pop-head button')).toBeNull();
      expect(view.target.querySelector('.strip .all')).not.toBeNull();
      const power = view.target.querySelector('.presets .power-preset') as HTMLButtonElement;
      expect(power.querySelector('svg')).not.toBeNull();
      expect(power.querySelector('.dot')).toBeNull();
      expect(power.getAttribute('aria-label')).toBe('widgets.leds.turnOff');

      (view.target.querySelectorAll('.strip .px')[1] as HTMLButtonElement).click();
      flushSync();
      expect(power.getAttribute('aria-label')).toBe('widgets.leds.turnOn');
      power.click();
      expect(state.toggleSelection).toHaveBeenCalledWith(item.id, [1]);
      expect(view.target.querySelector('.chip-popover')).not.toBeNull();

      (view.target.querySelector('.strip .all') as HTMLButtonElement).click();
      flushSync();
      power.click();
      expect(state.toggleSelection).toHaveBeenLastCalledWith(item.id, null);
    } finally { view.stop(); }
  });

  it('shows the visible RGBW color without a hash and keeps hex text LTR', () => {
    const item: LedItem = { id: 'led chamber', kind: 'led', name: 'chamber', label: 'Chamber', count: 1, hasWhite: true };
    const view = setup(item, [[0, 0, 0, 1]]);
    try {
      const value = view.target.querySelector('.state-text') as HTMLSpanElement;
      expect(value.textContent).toBe('FFFFFF');
      expect(value.classList.contains('color-value')).toBe(true);
      expect(value.getAttribute('dir')).toBe('ltr');
      expect(value.getAttribute('style')).toContain('--value-color: rgb(255, 255, 255)');
      (view.target.querySelector('.chip') as HTMLButtonElement).click();
      flushSync();
      expect((view.target.querySelector('.swatch-btn .swatch') as HTMLElement).style.backgroundColor)
        .toBe('rgb(255, 255, 255)');
    } finally { view.stop(); }

    // The same RGB channels must produce a different indicator when only white changes.
    const dimmed = setup(item, [[0, 0, 0, 0.5]]);
    try {
      (dimmed.target.querySelector('.chip') as HTMLButtonElement).click();
      flushSync();
      expect((dimmed.target.querySelector('.swatch-btn .swatch') as HTMLElement).style.backgroundColor)
        .toBe('rgb(128, 128, 128)');
    } finally { dimmed.stop(); }
  });
});
