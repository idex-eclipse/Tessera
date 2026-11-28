import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ColorPickerMenu from '../ColorPickerMenu.svelte';

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('ColorPickerMenu viewport placement', () => {
  it('shows an external swatch color without changing the editable RGB value', async () => {
    const target = document.createElement('div');
    document.body.appendChild(target);
    const onPick = vi.fn();
    const component = mount(ColorPickerMenu, {
      target,
      props: { value: '#000000', swatchColor: 'rgb(128, 128, 128)', onPick, i18n: { t: (key: string) => key } },
    });
    flushSync();
    expect((target.querySelector('.swatch-btn .swatch') as HTMLElement).style.backgroundColor)
      .toBe('rgb(128, 128, 128)');
    (target.querySelector('.swatch-btn') as HTMLButtonElement).click();
    flushSync();
    expect((target.querySelector('.cp-hex') as HTMLInputElement).value).toBe('#000000');
    (target.querySelector('.cp-grid .swatch:not(.none)') as HTMLButtonElement).click();
    expect(onPick).toHaveBeenCalledWith('#4285f4');
    await unmount(component);
  });

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
