import { flushSync, mount, unmount } from 'svelte';
import { describe, expect, it, vi } from 'vitest';

import type { PluginApi } from '../../../plugin-sdk/src/types';
import JobsFleetPanel from '../components/fleet/JobsFleetPanel.svelte';

vi.mock('../../../plugin-sdk/src/svelte/index', () => ({ useWidget: () => null }));
vi.mock('../components/shared/JobsBrowser.svelte', async () => ({
  default: (await import('./helpers/JobsBrowserProbe.svelte')).default,
}));

/** Mount a fleet launcher whose active and card printers differ. */
function setup() {
  const api = {
    printer: { id: 'active', name: 'Active' },
    printers: [{ id: 'active', name: 'Active' }, { id: 'target', name: 'Printer B' }],
    i18n: {
      locale: 'en',
      t: (key: string, params?: Record<string, string>) => key === 'jobs.fleetDialogTitle'
        ? `Jobs — ${params?.name}` : key,
    },
  } as unknown as PluginApi;
  const target = document.createElement('div');
  document.body.appendChild(target);
  const component = mount(JobsFleetPanel, {
    target,
    props: { mpuApi: api, mpuParams: { printerId: 'target' } },
  });
  flushSync();
  return { target, stop: () => { unmount(component); target.remove(); } };
}

describe('fleet Jobs dialog', () => {
  it('opens the full browser for the card printer and unmounts it on close', () => {
    const view = setup();
    try {
      (view.target.querySelector('button') as HTMLButtonElement).click();
      flushSync();
      expect(view.target.querySelector('[role="dialog"]')?.textContent).toContain('Jobs — Printer B');
      const browser = view.target.querySelector('[data-testid="jobs-browser"]') as HTMLElement;
      expect(browser.dataset.printer).toBe('target');
      expect(browser.dataset.title).toBe('false');
      expect(browser.textContent).toContain('full-file-actions-and-3mf');

      (view.target.querySelector('.close') as HTMLButtonElement).click();
      flushSync();
      expect(view.target.querySelector('[role="dialog"]')).toBeNull();
      expect(view.target.querySelector('[data-testid="jobs-browser"]')).toBeNull();
    } finally { view.stop(); }
  });

  it('closes with Escape and restores focus to the launcher', async () => {
    const view = setup();
    try {
      const launcher = view.target.querySelector('button') as HTMLButtonElement;
      launcher.focus();
      launcher.click();
      flushSync();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      flushSync();
      await Promise.resolve();
      expect(view.target.querySelector('[role="dialog"]')).toBeNull();
      expect(document.activeElement).toBe(launcher);
    } finally { view.stop(); }
  });
});
