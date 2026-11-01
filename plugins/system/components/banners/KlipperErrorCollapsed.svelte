<script lang="ts">
  import { usePluginApi } from '../../../../plugin-sdk/src/svelte/index';

  import Icon from '../../../shared/icons/Icon.svelte';
  import { useKlippyState } from '../../../shared/klippy-state/use-klippy-state.svelte.ts';

  import { isKlipperBannerVisible, klipperBannerTitleKey } from './klipper-banner-state.ts';

  const api = usePluginApi();
  const i18n = api.i18n;
  const klippy = useKlippyState(api);
</script>

{#if isKlipperBannerVisible(klippy.state)}
  <div class="kb-collapsed">
    <Icon name="warning" size={16} />
    <span class="kb-title">{i18n.t(klipperBannerTitleKey(klippy.state))}</span>
  </div>
{/if}

<style>
  .kb-collapsed {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
    min-width: 0;
    color: var(--warning);
  }

  .kb-title {
    min-width: 0;
    font-size: var(--font-size-sm);
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
