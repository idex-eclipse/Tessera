import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PluginApi } from '../../../plugin-sdk/src/types';
import ConfigTestApi from './helpers/ConfigTestApi.svelte';
import SessionProbe from './helpers/SessionProbe.svelte';
import { editorSession, editorSessions, openConfigSessionFile } from '../state/editor-session.svelte';

afterEach(() => {
  for (const id of Object.keys(editorSessions)) delete editorSessions[id];
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe('Config editor banner mount', () => {
  it('reads an absent session during rendering, then reacts when a file is opened', async () => {
    const api = {
      printer: { id: 'printer-one' },
      i18n: { t: (key: string) => key },
    } as unknown as PluginApi;
    const target = document.createElement('div');
    document.body.appendChild(target);
    // A component render is where Svelte rejects mutations from a derived value.
    const component = mount(ConfigTestApi, { target, props: { api, surface: 'banner' } });
    flushSync();
    expect(editorSessions['printer-one']).toBeUndefined();
    expect(target.querySelector('.editor-banner')).toBeNull();

    await openConfigSessionFile(api, { root: 'config', path: 'photo.png', isDir: false });
    editorSession('printer-one').expanded = false;
    flushSync();
    expect(target.querySelector('.editor-banner')).not.toBeNull();
    expect(target.textContent).toContain('photo.png');
    await unmount(component);
  });

  it('renders the loading state and the completed text read from the proxied tab', async () => {
    const api = {
      printer: { id: 'printer-two' },
      settingsFor: () => ({ get: () => undefined }),
      moonrakerFor: () => ({ httpBaseUrl: 'http://localhost', authToken: null }),
    } as unknown as PluginApi;
    const target = document.createElement('div');
    document.body.appendChild(target);
    const component = mount(SessionProbe, { target, props: { printerId: 'printer-two' } });
    flushSync();
    expect(target.textContent).toBe(':false');

    let finishRead!: (response: Response) => void;
    vi.stubGlobal('fetch', () => new Promise<Response>((resolve) => { finishRead = resolve; }));
    const opening = openConfigSessionFile(api, { root: 'config', path: 'notes.txt', isDir: false });
    flushSync();
    expect(target.textContent).toBe(':true');
    finishRead(new Response('loaded text', { status: 200 }));
    await opening;
    flushSync();
    expect(target.textContent).toBe('loaded text:false');
    await unmount(component);
  });

  it('mounts the persistent overlay and opens an image without a derived-state mutation', async () => {
    const api = {
      printer: { id: 'printer-three' },
      i18n: { t: (key: string) => key },
      moonrakerFor: () => ({ httpBaseUrl: 'http://localhost', authToken: null }),
      onLocaleChange: () => () => {},
    } as unknown as PluginApi;
    const target = document.createElement('div');
    document.body.appendChild(target);
    const component = mount(ConfigTestApi, { target, props: { api, surface: 'overlay' } });
    flushSync();
    expect(target.querySelector('.iv')).toBeNull();
    await openConfigSessionFile(api, { root: 'config', path: 'photo.png', isDir: false });
    flushSync();
    expect(target.querySelector('.iv')).not.toBeNull();
    await unmount(component);
  });

  it('shows the text editor after a file read completes', async () => {
    const localeListeners: Array<(locale: string, direction: 'ltr' | 'rtl') => void> = [];
    const handle = {
      httpBaseUrl: 'http://localhost', authToken: null, readyState: 'open',
      subscribe: () => () => {}, onNotify: () => () => {}, poll: () => () => {},
      onReady: () => () => {}, onConnectionStatusChange: () => () => {},
      request: async () => ({ state: 'ready' }),
    };
    const api = {
      pluginId: '@core/config', printer: { id: 'printer-four' }, printers: [{ id: 'printer-four' }],
      i18n: { t: (key: string) => key, locale: 'en' }, theme: { current: 'light' },
      moonrakerFor: () => handle,
      settingsFor: () => ({ get: () => undefined, set: () => {} }),
      onLocaleChange: (callback: (locale: string, direction: 'ltr' | 'rtl') => void) => {
        localeListeners.push(callback);
        return () => { localeListeners.splice(localeListeners.indexOf(callback), 1); };
      },
      onThemeChange: () => () => {},
      onPrinterChange: () => () => {}, onPrintersChange: () => () => {},
      extensions: { list: () => [], onChange: () => () => {} },
    } as unknown as PluginApi;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => new Response(
      String(input).includes('moonraker.conf') ? 'moonraker settings' : 'hello editor', { status: 200 },
    ));
    const target = document.createElement('div');
    const bannerTarget = document.createElement('div');
    document.body.appendChild(target);
    document.body.appendChild(bannerTarget);
    const component = mount(ConfigTestApi, { target, props: { api, surface: 'overlay' } });
    const banner = mount(ConfigTestApi, { target: bannerTarget, props: { api, surface: 'banner' } });
    flushSync();
    await openConfigSessionFile(api, { root: 'config', path: 'notes.txt', isDir: false });
    flushSync();
    expect(target.querySelector('.editor-overlay')).not.toBeNull();
    expect(target.textContent).toContain('notes.txt');
    (target.querySelector('button[aria-label="config.minimizeEditor"]') as HTMLButtonElement).click();
    flushSync();
    expect(target.querySelector('.editor-overlay')).toBeNull();
    expect(bannerTarget.querySelector('.editor-banner')).not.toBeNull();
    (bannerTarget.querySelector('.tab-select') as HTMLButtonElement).click();
    flushSync();
    expect(target.querySelector('.editor-overlay')).not.toBeNull();
    await openConfigSessionFile(api, { root: 'config', path: 'printer.cfg', isDir: false });
    flushSync();
    expect(target.querySelector('.cm-editor')).not.toBeNull();
    const toolbar = target.querySelector('.session-toolbar') as HTMLElement;
    const measurement = target.querySelector('.session-actions-measure') as HTMLElement;
    vi.spyOn(toolbar, 'getBoundingClientRect').mockReturnValue({ width: 800 } as DOMRect);
    const measureRect = vi.spyOn(measurement, 'getBoundingClientRect').mockReturnValue({ width: 500 } as DOMRect);
    window.dispatchEvent(new Event('resize'));
    flushSync();
    const actions = target.querySelector('.session-actions:not(.session-actions-measure)') as HTMLElement;
    expect(actions.classList.contains('matrix')).toBe(true);
    expect([...actions.querySelectorAll('button')].map((button) => button.getAttribute('aria-label')))
      .toEqual(['config.minimizeEditor', 'ft.close', 'config.editorSettings', 'config.saveAllClose']);
    measureRect.mockReturnValue({ width: 300 } as DOMRect);
    window.dispatchEvent(new Event('resize'));
    flushSync();
    expect(actions.classList.contains('matrix')).toBe(false);
    expect([...actions.querySelectorAll('button')].map((button) => button.getAttribute('aria-label')))
      .toEqual(['config.editorSettings', 'config.minimizeEditor', 'config.saveAllClose', 'ft.close']);
    const settingsButton = actions.querySelector('button[aria-label="config.editorSettings"]') as HTMLButtonElement;
    vi.spyOn(settingsButton, 'getBoundingClientRect').mockReturnValue({ left: 980, right: 1000, bottom: 48 } as DOMRect);
    settingsButton.click();
    flushSync();
    expect(target.querySelector('button[aria-label="ft.hl.title"]')).toBeNull();
    expect((target.querySelector('.hl-popover') as HTMLElement).style.insetInlineStart)
      .toBe(`${window.innerWidth - 300 - 8}px`);
    const devicesButton = target.querySelector('button[aria-label="ft.dev.title"]') as HTMLButtonElement;
    vi.spyOn(devicesButton, 'getBoundingClientRect').mockReturnValue({ left: 0, right: 50, bottom: 80 } as DOMRect);
    devicesButton.click();
    flushSync();
    expect((target.querySelector('.dev-popover') as HTMLElement).style.insetInlineStart).toBe('8px');
    // Plain conf files need a populated textarea as well as the syntax layer behind it.
    await openConfigSessionFile(api, { root: 'config', path: 'moonraker.conf', isDir: false });
    flushSync();
    expect((target.querySelector('.code-input') as HTMLTextAreaElement).value).toBe('moonraker settings');
    expect(target.querySelectorAll('.session-tab-select')).toHaveLength(3);
    const confInput = target.querySelector('.code-input') as HTMLTextAreaElement;
    confInput.value = 'edited moonraker settings';
    confInput.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    (target.querySelectorAll('.session-tab-select')[0] as HTMLButtonElement).click();
    flushSync();
    (target.querySelectorAll('.session-tab-select')[2] as HTMLButtonElement).click();
    flushSync();
    expect((target.querySelector('.code-input') as HTMLTextAreaElement).value).toBe('edited moonraker settings');
    expect(target.querySelectorAll('button[aria-label="ft.save"]')).toHaveLength(1);
    await openConfigSessionFile(api, { root: 'logs', path: 'klippy.log', isDir: false });
    flushSync();
    expect(target.querySelectorAll('.session-tab-select')).toHaveLength(4);
    await openConfigSessionFile(api, { root: 'config', path: 'photo.png', isDir: false });
    flushSync();
    expect(target.querySelector('.iv')).not.toBeNull();
    expect(target.querySelectorAll('.session-tab-select')).toHaveLength(5);
    const strip = target.querySelector('.session-tabs') as HTMLElement;
    let offset = 0;
    let rtl = false;
    // JSDOM has no layout, so a clamped scroll range models a real overflowing strip.
    Object.defineProperties(strip, {
      scrollWidth: { configurable: true, value: 900 },
      clientWidth: { configurable: true, value: 300 },
      scrollLeft: {
        configurable: true,
        get: () => offset,
        set: (value: number) => { offset = Math.max(rtl ? -600 : 0, Math.min(rtl ? 0 : 600, value)); },
      },
    });
    const forward = new WheelEvent('wheel', { deltaY: 80, bubbles: true, cancelable: true });
    strip.dispatchEvent(forward);
    expect(offset).toBe(80);
    expect(forward.defaultPrevented).toBe(true);
    offset = 600;
    const atEnd = new WheelEvent('wheel', { deltaY: 80, bubbles: true, cancelable: true });
    strip.dispatchEvent(atEnd);
    expect(atEnd.defaultPrevented).toBe(false);
    rtl = true;
    offset = 0;
    for (const notifyLocale of [...localeListeners]) notifyLocale('en', 'rtl');
    flushSync();
    strip.dispatchEvent(new WheelEvent('wheel', { deltaY: 80, bubbles: true, cancelable: true }));
    expect(offset).toBe(-80);
    await unmount(component);
    await unmount(banner);
  });
});
