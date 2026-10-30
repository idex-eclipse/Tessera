import type { KlippyState } from './use-klippy-state.svelte.ts';

/** Klipper в аварийном состоянии: `error` или `shutdown` (требуется restart). */
export function isKlippyFault(state: KlippyState): boolean {
  return state === 'error' || state === 'shutdown';
}
