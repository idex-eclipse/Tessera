<script lang="ts">
  import { usePluginApi } from '../../plugin-sdk/src/svelte/index';

  import { useKlippyState } from '../shared/klippy-state/use-klippy-state.svelte';
  import KlippyNotReadyChip from '../shared/klippy-state/KlippyNotReadyChip.svelte';

  import HeaderHelp from '../shared/header-help/HeaderHelp.svelte';

  import ConsoleControls from './console-controls.svelte';
  import ConsoleFilterMenu from './ConsoleFilterMenu.svelte';

  import Icon from '../shared/icons/Icon.svelte';

  const api = usePluginApi();
  const i18n = api.i18n;

  const klippy = useKlippyState(api);

  let printerId = $derived(api.printer.id);
  let fullscreenHref = $derived(`#/p/${printerId}/console`);

  let inputHint = $derived(
    !klippy.ready
  );
</script>

<div class="header-actions-row">
  {#if inputHint}
    <KlippyNotReadyChip />
  {/if}
  <ConsoleControls />
  <ConsoleFilterMenu />
  <a class="ctl" href={fullscreenHref} title={i18n.t('console.fullscreen')}>
    <Icon name="expand" size={16} />
  </a>
  <HeaderHelp title={i18n.t('console.help.Title')}>
    <h4>{i18n.t('console.help.AutocompleteTitle')}</h4>
    <p>{i18n.t('console.help.AutocompleteText')}</p>

    <h4>{i18n.t('console.help.ParamsTitle')}</h4>
    <p>{i18n.t('console.help.ParamsText')}</p>

    <h4>{i18n.t('console.help.HistoryTitle')}</h4>
    <p>{i18n.t('console.help.HistoryText')}</p>

    <h4>{i18n.t('console.help.ReverseTitle')}</h4>
    <p>{i18n.t('console.help.ReverseText')}</p>
  </HeaderHelp>
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