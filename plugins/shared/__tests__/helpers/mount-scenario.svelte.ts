import { flushSync, mount, unmount } from 'svelte';

import type { PluginApi } from '../../../../plugin-sdk/src/types';
import { createCoreKeeper } from '../../core-keeper/core-keeper';
import OwnershipProbe from './OwnershipProbe.svelte';

function makeCore() {
  let n = $state(1);
  const doubled = $derived(n * 2);
  return {
    get doubled() {
      return doubled;
    },
    bump() {
      n++;
    },
    destroy() {},
  };
}

/**
 * Mounts component A (which creates the core while initialising), unmounts it, mounts component B
 * (which only reads the core), bumps the core and reports what B shows. `viaKeeper = false` builds
 * the core directly in A's init - the pre-fix behaviour.
 */
export function runMountScenario(viaKeeper: boolean): { shown: string; warnings: string[] } {
  const warnings: string[] = [];
  const realWarn = console.warn;
  console.warn = (...args: unknown[]) => void warnings.push(args.map(String).join(' '));
  const target = document.createElement('div');
  document.body.appendChild(target);

  try {
    const keeper = createCoreKeeper({ create: makeCore });
    let direct: ReturnType<typeof makeCore> | null = null;
    const get = () =>
      viaKeeper ? keeper.get('p1', {} as PluginApi) : (direct ??= makeCore());

    const a = mount(OwnershipProbe, { target, props: { getCore: get } });
    flushSync();
    unmount(a);

    const b = mount(OwnershipProbe, { target, props: { getCore: get } });
    flushSync();
    get().bump();
    flushSync();
    const shown = target.querySelector('[data-testid="value"]')?.textContent ?? '';
    unmount(b);
    return { shown, warnings };
  } finally {
    console.warn = realWarn;
    target.remove();
  }
}
