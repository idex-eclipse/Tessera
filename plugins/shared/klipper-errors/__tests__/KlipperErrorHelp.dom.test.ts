import { flushSync, mount, unmount, type Component } from 'svelte';
import { describe, expect, it } from 'vitest';

import type { PluginApi } from '../../../../plugin-sdk/src/types';
import WithApi from '../../file-table/__tests__/helpers/WithApi.svelte';
import KlipperErrorHelp from '../KlipperErrorHelp.svelte';

/** Mounts the shared help with only the locale contract it consumes. */
function render(hintId: string, locale = 'en') {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const api = { i18n: { locale } } as unknown as PluginApi;
  const component = mount(WithApi, {
    target,
    props: {
      api,
      component: KlipperErrorHelp as unknown as Component<Record<string, unknown>>,
      props: { hintId, compact: true },
    },
  });
  flushSync();
  return { target, stop: () => { unmount(component); target.remove(); } };
}

describe('KlipperErrorHelp (jsdom)', () => {
  it('opens and closes the localised popover with keyboard-safe state', () => {
    const view = render('timer-too-close', 'ru');
    try {
      const button = view.target.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]');
      expect(button?.getAttribute('aria-expanded')).toBe('false');

      button?.click();
      flushSync();
      expect(button?.getAttribute('aria-expanded')).toBe('true');
      expect(document.body.textContent).toContain('Микроконтроллер получил команду слишком поздно');

      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      flushSync();
      expect(button?.getAttribute('aria-expanded')).toBe('false');
    } finally {
      view.stop();
    }
  });

  it('renders nothing for an unknown stable id', () => {
    const view = render('unknown-id');
    try {
      expect(view.target.querySelector('button')).toBeNull();
    } finally {
      view.stop();
    }
  });
});
