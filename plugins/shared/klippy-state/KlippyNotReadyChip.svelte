<script lang="ts">
  import { useI18n, usePluginApi } from '../../../plugin-sdk/src/svelte/index';

  import Icon from '../icons/Icon.svelte';
  import { useKlippyState } from './use-klippy-state.svelte.ts';

  const api = usePluginApi();
  const i18n = useI18n();
  const klippy = useKlippyState(api);
</script>

<!-- self-gating: чип виден только при Klipper не ready;
     родитель ничего не должен гейтить вокруг него -->
{#if !klippy.ready}
  <span class="knr-chip" title={i18n.t('common.klipperNotReady')}>
    <Icon name="warning" size={12} />
    <span class="knr-chip-text">{i18n.t('common.klipperNotReady')}</span>
  </span>
{/if}

<style>
  .knr-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--warning) 15%, transparent);
    color: var(--warning);
    font-size: var(--font-size-sm);
    white-space: nowrap;
    flex-shrink: 0;
  }

  .knr-chip-text {
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>