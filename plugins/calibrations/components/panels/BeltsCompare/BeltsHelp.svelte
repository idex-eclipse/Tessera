<script lang="ts">
  import { usePluginApi } from '../../../../../plugin-sdk/src/svelte/index';
  const i18n = usePluginApi().i18n;
</script>

<h4>{i18n.t('calibrations.belts.title')}</h4>
<p>{i18n.t('calibrations.belts.helpFlow')}</p>
<h4>{i18n.t('calibrations.belts.helpSnippetTitle')}</h4>
<p>{i18n.t('calibrations.belts.helpSnippet')}</p>
<h4>{i18n.t('calibrations.belts.helpReadTitle')}</h4>
<p>{i18n.t('calibrations.belts.helpRead')}</p>
<p class="warn">{i18n.t('calibrations.belts.helpKin')}</p>