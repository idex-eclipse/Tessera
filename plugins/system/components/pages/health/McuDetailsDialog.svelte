<script lang="ts">
  import { usePluginApi } from '../../../../../plugin-sdk/src/svelte/index';

  import Icon from '../../../../shared/icons/Icon.svelte';
  import type { McuHealth } from '../../../use-health.svelte.ts';
  import KvTable from '../KvTable.svelte';

  let { mcu, onClose }: { mcu: McuHealth; onClose: () => void } = $props();

  const i18n = usePluginApi().i18n;

  const fmtVal = (v: unknown): string => {
    if (v == null) return '—';
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
  };

  const toRows = (o: Record<string, unknown> | null) =>
    Object.entries(o ?? {}).map(([k, v]) => ({ k, v: fmtVal(v) }));

  let constants = $derived(toRows(mcu.constants));
  let stats = $derived(toRows(mcu.rawStats));

  function onKeydown(e: KeyboardEvent): void {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    e.preventDefault();
    onClose();
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div class="dlg-backdrop" onclick={onClose} role="presentation"></div>

<div class="dlg" role="dialog" aria-modal="true" aria-label={mcu.name}>
  <header class="dlg-header">
    <bdi class="dlg-title">{mcu.name}</bdi>
    <button type="button" class="icon-btn" aria-label={i18n.t('system.health.close')} onclick={onClose}>
      <Icon name="x" size={14} />
    </button>
  </header>

  <div class="dlg-body">
    <h4 class="dlg-section">{i18n.t('system.mcu.constants')}</h4>
    <KvTable rows={constants} />

    <h4 class="dlg-section">{i18n.t('system.mcu.lastStats')}</h4>
    <KvTable rows={stats} />
  </div>
</div>

<style>
  .dlg-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    z-index: 450;
  }

  .dlg {
    position: fixed;
    top: 50%;
    inset-inline-start: 50%;
    transform: translate(-50%, -50%);
    width: 90%;
    max-width: 560px;
    max-height: 80vh;
    display: flex;
    flex-direction: column;
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg);
    z-index: 451;
  }

  :global([dir='rtl']) .dlg {
    transform: translate(50%, -50%);
  }

  .dlg-header {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    padding: var(--space-sm) var(--space-md);
    border-bottom: 1px solid var(--border-color);
    flex-shrink: 0;
  }

  .dlg-title {
    flex: 1;
    min-width: 0;
    font-family: monospace;
    font-weight: 600;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .dlg-body {
    padding: var(--space-md);
    overflow-y: auto;
    min-height: 0;
  }

  .dlg-section {
    margin: 0 0 var(--space-xs);
    font-size: var(--font-size-md);
    font-weight: 600;
    color: var(--text-primary);
  }

  .dlg-section:not(:first-child) {
    margin-top: var(--space-md);
  }

  .icon-btn {
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
    flex-shrink: 0;
  }

  .icon-btn:hover {
    background: var(--bg-surface-hover);
    color: var(--text-primary);
  }
</style>
