/**
 * Runs `fn` under its own effect root, so any `$state` / `$derived` it creates belongs to that
 * root instead of whichever component effect happens to be running.
 *
 * Why (roadmap bug `derived_inert` in use-cameras): keep-alive cores are created lazily - usually
 * during the first consumer's component init - and outlive it. A `$derived` created there is owned
 * by that component's effect; when the component is destroyed the derived turns inert and later
 * reads return stale values (Svelte warns `derived_inert`). Giving every core a root of its own
 * ties the lifetime of its reactive state to the core, not to a component. `dispose` ends the root
 * and must be called when the core is destroyed.
 *
 * Only a client-compiled build runs `$effect.root`; the server compile (used by vitest in the
 * `node` environment and by SSR) turns it into a no-op that never calls the callback, so `fn` is
 * run directly there. Nothing is lost: there is no reactivity to own on the server.
 */
export function runDetached<T>(fn: () => T): { value: T; dispose: () => void } {
  let ran = false;
  let value: T | undefined;
  const dispose = $effect.root(() => {
    ran = true;
    value = fn();
  });
  if (!ran) value = fn();
  return { value: value as T, dispose };
}
