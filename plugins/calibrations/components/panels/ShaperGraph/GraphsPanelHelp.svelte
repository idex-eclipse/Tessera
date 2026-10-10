<script lang="ts">
  import { usePluginApi } from '../../../../../plugin-sdk/src/svelte/index';
  const i18n = usePluginApi().i18n;
</script>

<h4>{i18n.t('calibrations.graphs.title')}</h4>
<p>{i18n.t('calibrations.graphs.helpDiscovery')}</p>
<h4>{i18n.t('calibrations.graphs.previewTitle')}</h4>
<p>{i18n.t('calibrations.graphs.helpPreview')}</p>
<p class="warn">{i18n.t('calibrations.graphs.sideEffect')}</p>