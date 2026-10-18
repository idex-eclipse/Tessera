<script lang="ts">
  import { onDestroy } from 'svelte';

  import { useWidget } from '../../../../plugin-sdk/src/svelte/index';

  import HeaderHelp from '../../../shared/header-help/HeaderHelp.svelte';

  import StatusSettingsMenu from '../StatusSettingsMenu.svelte';

  const api = useWidget();
  const i18n = api.i18n;

  let banner = $state(api.settings.get<boolean>('status.banner') ?? true);

  const off = api.settings.onChange((k, v) => {
    if (k === 'status.banner') banner = Boolean(v);
  });
  onDestroy(off);
</script>

<div class="hdr">
  <HeaderHelp title={i18n.t('system.status.help.Title')}>
    <h4>{i18n.t('system.status.help.ModesTitle')}</h4>
    <p>{i18n.t('system.status.help.ModesText')}</p>

    <h4>{i18n.t('system.status.help.FieldsTitle')}</h4>
    <p>{i18n.t('system.status.help.FieldsText')}</p>

    <h4>{i18n.t('system.status.help.BannerTitle')}</h4>
    <p>{i18n.t('system.status.help.BannerText')}</p>
  </HeaderHelp>

  <StatusSettingsMenu {api} showBannerToggle={true} />
</div>

<style>
  .hdr {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
  }
</style>