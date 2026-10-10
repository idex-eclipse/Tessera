<script lang="ts">
  import { usePluginApi } from '../../../../../plugin-sdk/src/svelte/index';
  const i18n = usePluginApi().i18n;
</script>

<h4>{i18n.t('calibrations.section.mesh')}</h4>
<p>{i18n.t('calibrations.help.mesh')}</p>