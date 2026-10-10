<script lang="ts">
  import { usePluginApi } from '../../plugin-sdk/src/svelte/index';

  import { getPrefs, setPrefs } from './console-session.svelte';

  const api = usePluginApi();
  const i18n = api.i18n;

  let printerId = $derived(api.printer.id);
  let prefs = $derived(getPrefs(printerId));
</script>

<button
  class="ctl"
  class:active={prefs.autoscroll}
  onclick={() => setPrefs(api, printerId, { autoscroll: !prefs.autoscroll })}
  title={i18n.t('console.autoscroll')}
>
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <polyline points="7 6 12 11 17 6"></polyline>
    <polyline points="7 13 12 18 17 13"></polyline>
  </svg>
</button>

<button
  class="ctl"
  class:active={prefs.reverse}
  onclick={() => setPrefs(api, printerId, { reverse: !prefs.reverse })}
  title={i18n.t('console.reverse')}
>
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="m21 16-4 4-4-4"></path>
    <path d="M17 20V4"></path>
    <path d="m3 8 4-4 4 4"></path>
    <path d="M7 4v16"></path>
  </svg>
</button>

<style>
  .ctl {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
  }

  .ctl:hover { background: var(--bg-surface-hover); color: var(--text-primary); }
  .ctl.active { color: var(--accent); background: var(--bg-surface-active); }
  .ctl svg { width: 16px; height: 16px; }
</style>