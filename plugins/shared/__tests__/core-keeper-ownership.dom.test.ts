import { describe, expect, it } from 'vitest';

import { runMountScenario } from './helpers/mount-scenario.svelte';

const inert = (warnings: string[]) => warnings.filter((w) => w.includes('derived_inert'));

/**
 * Regression for the roadmap bug `derived_inert` (use-cameras, use-bed-mesh). Runs in jsdom, where
 * Svelte is compiled for the browser; see vitest.config.ts.
 */
describe('core keeper: who owns a core\'s reactive state', () => {
  it('control: a core built inside the first component\'s init goes stale when that component dies', () => {
    // The old behaviour. It proves the scenario really reproduces the bug, so the next test
    // cannot pass for the wrong reason.
    const { shown, warnings } = runMountScenario(false);
    expect(inert(warnings).length).toBeGreaterThan(0);
    expect(shown).toBe('2'); // stale: should be 4
  });

  it('a core created through the keeper outlives its first component and stays fresh', () => {
    const { shown, warnings } = runMountScenario(true);
    expect(inert(warnings)).toEqual([]);
    expect(shown).toBe('4');
  });
});
