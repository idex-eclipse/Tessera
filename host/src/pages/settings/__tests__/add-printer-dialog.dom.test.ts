import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { closeAddPrinter, openAddPrinter } from '../add-printer-dialog-store.svelte';

const addPrinter = vi.fn();

// The dialog needs only the manager and translations from the host context.
vi.mock('../../../app-context', () => ({
  getAppContext: () => ({
    printerManager: { addPrinter },
    i18n: { t: (key: string) => key },
  }),
}));

import AddPrinterDialog from '../add-printer-dialog.svelte';

afterEach(() => {
  closeAddPrinter();
  addPrinter.mockClear();
  vi.unstubAllGlobals();
});

describe('AddPrinterDialog (jsdom)', () => {
  it.each([
    ['192.168.1.20', 'http://192.168.1.20:7125'],
    ['https://printer.local:8443', 'https://printer.local:8443'],
  ])('tests and saves the same address for %s', async (input, expected) => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ result: { moonraker_version: '0.9' } }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const target = document.createElement('div');
    document.body.appendChild(target);
    openAddPrinter();
    const component = mount(AddPrinterDialog, { target });
    flushSync();

    try {
      const inputs = target.querySelectorAll<HTMLInputElement>('input');
      const buttons = target.querySelectorAll<HTMLButtonElement>('button');
      expect(inputs).toHaveLength(2);
      expect(buttons).toHaveLength(3);

      inputs[0]!.value = 'Workshop';
      inputs[0]!.dispatchEvent(new Event('input', { bubbles: true }));
      inputs[1]!.value = input;
      inputs[1]!.dispatchEvent(new Event('input', { bubbles: true }));
      flushSync();

      buttons[0]!.click();
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledWith(`${expected}/server/info`));
      buttons[2]!.click();
      expect(addPrinter).toHaveBeenCalledWith({ name: 'Workshop', url: expected });
    } finally {
      unmount(component);
      target.remove();
    }
  });

  it('blocks an invalid address and shows a localized error', () => {
    const target = document.createElement('div');
    document.body.appendChild(target);
    openAddPrinter();
    const component = mount(AddPrinterDialog, { target });
    flushSync();

    try {
      const input = target.querySelectorAll<HTMLInputElement>('input')[1]!;
      input.value = 'ftp://printer.local';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      flushSync();

      expect(input.getAttribute('aria-invalid')).toBe('true');
      expect(input.getAttribute('aria-describedby')).toBe('add-printer-url-error');
      expect(target.textContent).toContain('settings.invalidPrinterUrl');
      expect(target.querySelectorAll<HTMLButtonElement>('button')[0]?.disabled).toBe(true);
    } finally {
      unmount(component);
      target.remove();
    }
  });
});
