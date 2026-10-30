import { describe, expect, it } from 'vitest';

import { isKlippyFault } from '../klippy-state/klippy-fault';

describe('isKlippyFault', () => {
  it.each(['error', 'shutdown'] as const)('%s is a fault', (state) => {
    expect(isKlippyFault(state)).toBe(true);
  });

  it.each(['ready', 'startup', 'disconnected', 'unknown'] as const)('%s is not a fault', (state) => {
    expect(isKlippyFault(state)).toBe(false);
  });
});
