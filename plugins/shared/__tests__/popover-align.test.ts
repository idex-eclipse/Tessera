import { describe, expect, it } from 'vitest';

import { shouldAlignToEnd, shouldOpenAbove } from '../popover-align';

describe('shouldOpenAbove', () => {
  const vh = 800;

  it('opens below by default when there is room', () => {
    expect(shouldOpenAbove({ top: 100, bottom: 180 }, 220, vh)).toBe(false);
  });

  it('opens below even when there is more room above, as long as it fits below', () => {
    expect(shouldOpenAbove({ top: 500, bottom: 580 }, 200, vh)).toBe(false);
  });

  it('opens above only when it does not fit below and there is more room above', () => {
    expect(shouldOpenAbove({ top: 600, bottom: 680 }, 220, vh)).toBe(true);
  });

  it('stays below when it fits neither way but below has more room', () => {
    // 300px viewport: chip near the top, popover taller than either side
    expect(shouldOpenAbove({ top: 20, bottom: 100 }, 400, 300)).toBe(false);
  });
});

describe('shouldAlignToEnd', () => {
  it('flips when the popover would overflow the start side', () => {
    expect(shouldAlignToEnd({ left: 300, right: 400 }, 240, 500, false)).toBe(true);
    expect(shouldAlignToEnd({ left: 20, right: 120 }, 240, 500, false)).toBe(false);
    expect(shouldAlignToEnd({ left: 20, right: 100 }, 240, 500, true)).toBe(true);
  });
});
