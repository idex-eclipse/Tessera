import { describe, expect, it } from 'vitest';

import { settingsNarrow, settingsView } from '../settings-view';

describe('settingsNarrow', () => {
  it('is narrow in the host mobile mode whatever the page width', () => {
    expect(settingsNarrow(true, 900)).toBe(true);
  });

  it('keeps the split layout down to 560px and breaks below', () => {
    expect(settingsNarrow(false, 560)).toBe(false);
    expect(settingsNarrow(false, 559)).toBe(true);
  });

  it('stays wide until the page is measured', () => {
    expect(settingsNarrow(false, 0)).toBe(false);
  });
});

describe('settingsView', () => {
  it('shows nav and tab side by side when wide, with or without a section', () => {
    expect(settingsView(false, null)).toBe('wide');
    expect(settingsView(false, 'printers')).toBe('wide');
  });

  it('shows the tab list when narrow and no section is chosen', () => {
    expect(settingsView(true, null)).toBe('list');
    expect(settingsView(true, '')).toBe('list');
  });

  it('shows the tab on top when narrow and a section is chosen', () => {
    expect(settingsView(true, 'plugins')).toBe('detail');
  });
});
