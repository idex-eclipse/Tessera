<script lang="ts">
  import { usePluginApi } from '../../../plugin-sdk/src/svelte/index';

  import HeaderHelp from '../../shared/header-help/HeaderHelp.svelte';

  const i18n = usePluginApi().i18n;
</script>

<HeaderHelp title={i18n.t('console.help.Title')}>
  <h4>{i18n.t('console.help.AutocompleteTitle')}</h4>
  <p>{i18n.t('console.help.AutocompleteText')}</p>

  <h4>{i18n.t('console.help.ParamsTitle')}</h4>
  <p>{i18n.t('console.help.ParamsText')}</p>

  <h4>{i18n.t('console.help.HistoryTitle')}</h4>
  <p>{i18n.t('console.help.HistoryText')}</p>

  <h4>{i18n.t('console.help.ReverseTitle')}</h4>
  <p>{i18n.t('console.help.ReverseText')}</p>

  <h4>{i18n.t('console.help.FiltersTitle')}</h4>
  <p>{i18n.t('console.help.FiltersText')}</p>

  <h4>{i18n.t('console.help.SafetyTitle')}</h4>
  <p>{i18n.t('console.help.SafetyText')}</p>
</HeaderHelp>
