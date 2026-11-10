import { flushSync } from 'svelte';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { PluginApi } from '../../../plugin-sdk/src/types';
import { defineMpuElement } from '../../../plugin-sdk/src/element/define-element';
import NotificationPageAction from '../notification-actions/NotificationPageAction.svelte';

const TAG = 'test-notification-page-action';

beforeAll(() => defineMpuElement(TAG, NotificationPageAction));

afterEach(() => {
  document.documentElement.removeAttribute('dir');
  globalThis.location.hash = '';
  document.body.replaceChildren();
});

describe('NotificationPageAction (jsdom)', () => {
  it('keeps the notification printer and URL-encodes the requested heater in narrow RTL layouts', () => {
    document.documentElement.dir = 'rtl';
    Object.defineProperty(globalThis, 'innerWidth', { configurable: true, value: 375 });
    const api = {
      printer: { id: 'currently-active', name: 'Active', url: '' },
      i18n: { t: (key: string) => key, locale: 'en' },
    } as unknown as PluginApi;
    const element = document.createElement(TAG) as HTMLElement & {
      api: PluginApi;
      params: Record<string, string>;
    };
    element.api = api;
    element.params = {
      printerId: 'printer /one',
      pageId: 'calibrations',
      section: 'heaters',
      heater: 'chamber /left',
      labelKey: 'calibrations.heaters.openHeaters',
    };
    document.body.appendChild(element);
    flushSync();

    element.querySelector<HTMLButtonElement>('button')?.click();

    expect(globalThis.location.hash).toBe(
      '#/p/printer%20%2Fone/calibrations?section=heaters&heater=chamber+%2Fleft',
    );
    expect(globalThis.location.hash).not.toContain('currently-active');
  });
});
