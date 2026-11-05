<script lang="ts">
  import { useWidget } from '../../../../../plugin-sdk/src/svelte/index';

  import HeaderHelp from '../../../../shared/header-help/HeaderHelp.svelte';

  import StatusSettingsMenu from '../../shared/StatusSettingsMenu.svelte';

  const api = useWidget();
  const i18n = api.i18n;

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