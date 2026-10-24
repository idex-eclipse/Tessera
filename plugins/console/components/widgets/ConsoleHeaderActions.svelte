<script lang="ts">
  import { usePluginApi } from '../../../../plugin-sdk/src/svelte/index';

  import { useKlippyState } from '../../../shared/klippy-state/use-klippy-state.svelte';
  import KlippyNotReadyChip from '../../../shared/klippy-state/KlippyNotReadyChip.svelte';
  import Icon from '../../../shared/icons/Icon.svelte';
  import { pageHash } from '../../../shared/page-nav';

  import ConsoleControls from '../ConsoleControls.svelte';
  import ConsoleFilterMenu from '../ConsoleFilterMenu.svelte';
  import ConsoleHelp from '../ConsoleHelp.svelte';

  const api = usePluginApi();
  const i18n = api.i18n;

  const klippy = useKlippyState(api);

  let fullscreenHref = $derived(pageHash(api.printer.id, 'console'));
</script>

<div class="header-actions-row">
  {#if !klippy.ready}
    <KlippyNotReadyChip />
  {/if}
  <ConsoleControls />
  <ConsoleFilterMenu />
  <a class="ctl" href={fullscreenHref} title={i18n.t('console.fullscreen')} aria-label={i18n.t('console.fullscreen')}>
    <Icon name="expand" size={16} />
  </a>
  <ConsoleHelp />
</div>

<style>
  .header-actions-row {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
  }

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
    text-decoration: none;
  }

  .ctl:hover { background: var(--bg-surface-hover); color: var(--text-primary); }
</style>
