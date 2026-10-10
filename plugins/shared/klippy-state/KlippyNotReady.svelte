<script lang="ts">
  import { useI18n } from '../../../plugin-sdk/src/svelte/index';

  import Icon from '../icons/Icon.svelte';

  let { hint = null }: { hint?: string | null } = $props();

  const i18n = useI18n();
</script>

<div class="knr">
  <Icon name="warning" size={20} />
  <span class="knr-title">{i18n.t('common.klipperNotReady')}</span>
  {#if hint}<span class="knr-hint">{hint}</span>{/if}
</div>

<style>
  .knr {
    height: 100%;
    min-height: 80px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-xs);
    padding: var(--space-md);
    color: var(--text-muted);
    text-align: center;
  }

  .knr-title {
    font-size: var(--font-size-sm);
    font-weight: 600;
  }

  .knr-hint {
    font-size: var(--font-size-sm);
  }
</style>