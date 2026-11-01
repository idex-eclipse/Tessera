import { describe, expect, it } from 'vitest';

import { chipPopoverStyle, shouldAlignToEnd, shouldOpenAbove } from '../popover-align';

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

describe('chipPopoverStyle', () => {
  const viewport = { width: 400, height: 800 };
  const popover = { width: 200, height: 200 };

  it('LTR: below the chip, anchored to its left edge', () => {
    const rect = { left: 20, right: 120, top: 100, bottom: 180 };
    expect(chipPopoverStyle(rect, popover, viewport, false)).toBe(
      'top: 186px; bottom: auto; left: 20px; right: auto;',
    );
  });

  it('LTR: anchors to the right edge when it would overflow the viewport', () => {
    const rect = { left: 280, right: 380, top: 100, bottom: 180 };
    expect(chipPopoverStyle(rect, popover, viewport, false)).toBe(
      'top: 186px; bottom: auto; left: auto; right: 20px;',
    );
  });

  it('RTL: anchors to the right edge by default, to the left one on overflow', () => {
    const start = { left: 280, right: 380, top: 100, bottom: 180 };
    expect(chipPopoverStyle(start, popover, viewport, true)).toBe(
      'top: 186px; bottom: auto; left: auto; right: 20px;',
    );
    const end = { left: 20, right: 120, top: 100, bottom: 180 };
    expect(chipPopoverStyle(end, popover, viewport, true)).toBe(
      'top: 186px; bottom: auto; left: 20px; right: auto;',
    );
  });

  it('opens above when it does not fit below', () => {
    const rect = { left: 20, right: 120, top: 650, bottom: 730 };
    expect(chipPopoverStyle(rect, popover, viewport, false)).toBe(
      'top: auto; bottom: 156px; left: 20px; right: auto;',
    );
  });

  it('keeps a margin from the viewport edge for a chip scrolled off screen', () => {
    const rect = { left: -50, right: 50, top: 100, bottom: 180 };
    expect(chipPopoverStyle(rect, popover, viewport, false)).toContain('left: 8px;');
  });
});
