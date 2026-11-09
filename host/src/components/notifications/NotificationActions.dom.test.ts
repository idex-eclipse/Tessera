import { flushSync, mount, unmount } from 'svelte';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { PluginApi } from '../../../../plugin-sdk/src/types';

const fakeApi = { pluginId: '@core/system' } as PluginApi;

// NotificationActions needs the app context only because PluginSurface resolves the author's API.
vi.mock('../../app-context', () => ({ getAppContext: () => ({}) }));
vi.mock('../../core/plugin-api-cache', () => ({ getPluginApi: () => fakeApi }));

import NotificationActions from './NotificationActions.svelte';

class TestNotificationAction extends HTMLElement {}

beforeAll(() => {
  if (!customElements.get('test-notification-action')) {
    customElements.define('test-notification-action', TestNotificationAction);
  }
});

describe('NotificationActions (jsdom)', () => {
  it('mounts registered actions with the author API and copied params', () => {
    const target = document.createElement('div');
    document.body.appendChild(target);
    const component = mount(NotificationActions, {
      target,
      props: {
        pluginId: '@core/system',
        actions: [{ element: 'test-notification-action', params: { hintId: 'timer-too-close' } }],
      },
    });
    flushSync();

    try {
      const action = target.querySelector<TestNotificationAction & {
        api: PluginApi;
        params: Record<string, string>;
      }>('test-notification-action');
      expect(action?.api).toBe(fakeApi);
      expect(action?.params).toEqual({ hintId: 'timer-too-close' });
      expect(action?.dataset.hintId).toBe('timer-too-close');
    } finally {
      unmount(component);
      target.remove();
    }
  });

  it('silently omits an unavailable action element', () => {
    const target = document.createElement('div');
    const component = mount(NotificationActions, {
      target,
      props: { pluginId: '@core/system', actions: [{ element: 'missing-notification-action' }] },
    });
    flushSync();
    try {
      expect(target.textContent).toBe('');
      expect(target.querySelector('.plugin-error')).toBeNull();
    } finally {
      unmount(component);
    }
  });
});
