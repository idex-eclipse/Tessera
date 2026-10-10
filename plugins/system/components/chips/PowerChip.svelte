<script lang="ts">
  import { usePluginApi } from '../../../../plugin-sdk/src/svelte/index';
  import { useSystem } from '../../use-system.svelte';
  import Icon from '../../../shared/icons/Icon.svelte';

  let { params = {} }: { params?: Record<string, string> } = $props();

  const api = usePluginApi();
  const i18n = api.i18n;
  const system = useSystem(api);

  let deviceId = $derived(params.chipId ?? '');
  let editMode = $derived(params.edit === '1');
  let customLabel = $derived(params.chipLabel);

  let device = $derived(system.power.find((d) => d.device === deviceId) ?? null);
  let label = $derived(customLabel || device?.device || deviceId);
  let isOn = $derived(device?.status === 'on');
  let missing = $derived(device === null);

  // Moonraker-level: не зависит от Klipper ready; offline → muted
  let online = $derived(api.moonraker().readyState === 'open');
  let disabled = $derived(editMode || missing || !online);

  function toggle(): void {
    if (disabled || !device) return;
    system.powerSet(device.device, 'toggle');
  }
</script>

<div class="chip-root">
  <div
    class="chip"
    class:on={isOn}
    class:missing
    class:interactive={!disabled}
    onclick={toggle}
    role="button"
    tabindex={disabled ? -1 : 0}
    onkeydown={(e) => { if (e.key === 'Enter' && !disabled) toggle(); }}
    title={missing ? i18n.t('system.power.unavailableHint') : isOn ? i18n.t('system.power.on') : i18n.t('system.power.off')}
  >
    <span class="stripe"></span>
    <span class="body">
      <span class="top">
        <span class="category">{i18n.t('system.power.chipSection')}</span>
      </span>
      <span class="bottom">
        <span class="kind" class:lit={isOn}><Icon name="kind-power" size={40} /></span>
        <span class="info">
          <span class="name" title={missing ? i18n.t('system.power.unavailableHint') : label}>{label}</span>
          <span class="status" class:unavailable={missing}>{missing ? i18n.t('system.power.unavailable') : isOn ? i18n.t('system.power.onChip') : i18n.t('system.power.offChip')}</span>
        </span>
      </span>
    </span>
  </div>
</div>

<style>
  .chip-root { position: relative; height: 100%; }

  .chip {
    position: relative;
    display: flex;
    align-items: stretch;
    height: 100%;
    min-width: 104px;
    max-width: 240px;
    padding: 4px 10px 6px 12px;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    background: var(--bg-surface);
    overflow: hidden;
    transition: background var(--transition-fast), border-color var(--transition-fast), box-shadow var(--transition-fast);
  }

  .stripe {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 3px;
    background: var(--text-muted);
  }
  .chip.on .stripe { background: var(--accent); }

  .body {
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    min-width: 0;
    flex: 1;
  }

  .top { display: flex; align-items: baseline; gap: 6px; min-width: 0; font-weight: 600; }
  .category {
    font-size: var(--font-size-lg);
    color: var(--accent);
    white-space: nowrap;
  }

  .bottom { display: flex; align-items: center; gap: 6px; }
  .kind { display: flex; line-height: 0; color: var(--text-muted); opacity: 0.55; flex-shrink: 0; }
  .kind.lit { opacity: 1; color: var(--accent); }

  .info {
    display: flex;
    flex-direction: column;
    min-width: 0;
    flex: 1;
  }

  .name {
    font-size: var(--font-size-sm);
    font-weight: 600;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .status {
    font-size: var(--font-size-sm);
    font-weight: 600;
    color: var(--text-muted);
  }
  .status.unavailable { color: var(--text-muted); font-style: italic; }
  .chip.on .status { color: var(--warning); }

  .chip.on {
    background: var(--bg-surface-hover);
    border-color: color-mix(in srgb, var(--warning) 32%, var(--border-color));
  }

  .chip.interactive { cursor: pointer; }
  .chip.interactive:hover {
    box-shadow: var(--shadow-sm);
    border-color: color-mix(in srgb, var(--accent) 45%, var(--border-color));
  }
  .chip.interactive:active { transform: translateY(1px); }
  .chip.missing { border-style: dashed; }
  .chip.missing .name { color: var(--text-muted); }
</style>