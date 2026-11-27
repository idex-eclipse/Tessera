import { flushSync, mount, unmount } from 'svelte';
import { describe, expect, it, vi } from 'vitest';

import type { HostI18n } from '../../core/host-i18n.svelte.ts';

import FleetFiltersPopover from './FleetFiltersPopover.svelte';

// The host supplies localized keys; this fixture makes every label observable.
const i18n = { t: (key: string) => key } as HostI18n;
const tags = [
  { tag: { id: 'printing', labelKey: 'fleet.filter.printing', icon: 'print' }, count: 2 },
  { tag: { id: 'idle', labelKey: 'fleet.filter.idle' }, count: 0 },
];

describe('FleetFiltersPopover (jsdom)', () => {
  it('shows checked tags, changes mode, and dismisses Escape before the drawer sees it', () => {
    const target = document.createElement('div');
    document.body.appendChild(target);
    const onToggleTag = vi.fn();
    const onModeChange = vi.fn();
    const drawerKeydown = vi.fn();
    window.addEventListener('keydown', drawerKeydown);
    const component = mount(FleetFiltersPopover, {
      target,
      props: {
        i18n,
        tags,
        activeTagIds: new Set(['printing']),
        mode: 'or',
        onToggleTag,
        onModeChange,
      },
    });
    flushSync();

    try {
      const trigger = target.querySelector<HTMLButtonElement>('.filter-trigger')!;
      expect(trigger.textContent).toContain('1');
      trigger.click();
      flushSync();

      expect(trigger.getAttribute('aria-expanded')).toBe('true');
      const checks = target.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
      expect(checks).toHaveLength(2);
      expect(checks[0]?.checked).toBe(true);
      expect(checks[1]?.checked).toBe(false);
      expect(target.querySelector('.tag-count')?.textContent).toBe('2');
      checks[1]?.click();
      expect(onToggleTag).toHaveBeenCalledWith('idle');

      target.querySelector<HTMLInputElement>('input[value="and"]')?.click();
      expect(onModeChange).toHaveBeenCalledWith('and');

      drawerKeydown.mockClear();
      target.querySelector('input')?.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Escape', bubbles: true, cancelable: true,
      }));
      flushSync();
      expect(trigger.getAttribute('aria-expanded')).toBe('false');
      expect(document.activeElement).toBe(trigger);
      expect(drawerKeydown).not.toHaveBeenCalled();
    } finally {
      unmount(component);
      window.removeEventListener('keydown', drawerKeydown);
      target.remove();
    }
  });

  it('closes when focus moves outside the popover', () => {
    const target = document.createElement('div');
    const outside = document.createElement('button');
    document.body.append(target, outside);
    const component = mount(FleetFiltersPopover, {
      target,
      props: { i18n, tags, activeTagIds: new Set<string>(), mode: 'or', onToggleTag: vi.fn(), onModeChange: vi.fn() },
    });
    flushSync();

    try {
      const trigger = target.querySelector<HTMLButtonElement>('.filter-trigger')!;
      trigger.click();
      flushSync();
      outside.focus();
      flushSync();
      expect(trigger.getAttribute('aria-expanded')).toBe('false');
      expect(document.activeElement).toBe(outside);
    } finally {
      unmount(component);
      target.remove();
      outside.remove();
    }
  });
});
