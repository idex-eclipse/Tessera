import { untrack } from 'svelte';

// Jobs can own a fleet dialog and a nested 3MF inspector at the same time.
let modalOwners = $state(0);

/** Reactive modal state used by Jobs hotkeys. */
export const jobsUi = {
  get modalOpen(): boolean { return modalOwners > 0; },
};

/** Hold the Jobs modal lock until the returned disposer runs. */
export function acquireJobsModal(): () => void {
  // Modal-owning effects must not subscribe to the counter they update.
  modalOwners = untrack(() => modalOwners) + 1;
  let held = true;
  return () => {
    if (!held) return;
    held = false;
    modalOwners = Math.max(0, untrack(() => modalOwners) - 1);
  };
}

/** Reset module state between isolated unit tests. */
export function resetJobsModalForTests(): void {
  modalOwners = 0;
}
