import { flushSync, mount, unmount } from 'svelte';
import { describe, expect, it } from 'vitest';

import ConfigCompareView from '../ConfigCompareView.svelte';

describe('config backup comparison', () => {
  it('renders only physical backup lines when the current file has additions', async () => {
    const target = document.createElement('div');
    document.body.appendChild(target);
    const view = mount(ConfigCompareView, {
      target,
      props: { before: 'old\nkeep', after: 'new\nextra\nkeep', lang: 'plain' },
    });
    flushSync();
    // Diff placeholders would add a blank row and shift all following backup lines.
    expect(Array.from(target.querySelectorAll('.backup-line code')).map((line) => line.textContent)).toEqual(['old', 'keep']);
    await unmount(view);
    target.remove();
  });
});
