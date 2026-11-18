import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ColorPickerMenu from '../ColorPickerMenu.svelte';

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('ColorPickerMenu viewport placement', () => {
  it('keeps the picker visible at the inline and block edges', async () => {
    // JSDOM has no layout, so measured rectangles model a trigger near the screen edge.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains('cp-menu')) return { height: 400 } as DOMRect;
      if (this.classList.contains('swatch-btn')) return {
        left: 0, right: 20, bottom: window.innerHeight - 20,
      } as DOMRect;
      return { height: 0 } as DOMRect;
    });
    const target = document.createElement('div');
    document.body.appendChild(target);
    const component = mount(ColorPickerMenu, {
      target, props: { value: null, onPick: vi.fn(), i18n: { t: (key: string) => key } },
    });
    flushSync();
    (target.querySelector('.swatch-btn') as HTMLButtonElement).click();
    flushSync();
    const menu = target.querySelector('.cp-menu') as HTMLElement;
    expect(menu.style.insetInlineStart).toBe('8px');
    expect(menu.style.insetBlockStart).toBe(`${window.innerHeight - 408}px`);
    await unmount(component);
    target.setAttribute('dir', 'rtl');
    const rtlComponent = mount(ColorPickerMenu, {
      target, props: { value: null, onPick: vi.fn(), i18n: { t: (key: string) => key } },
    });
    flushSync();
    (target.querySelector('.swatch-btn') as HTMLButtonElement).click();
    flushSync();
    expect((target.querySelector('.cp-menu') as HTMLElement).style.insetInlineStart)
      .toBe(`${window.innerWidth - 248}px`);
    await unmount(rtlComponent);
  });
});
