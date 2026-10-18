<script lang="ts">
  import { usePluginApi } from '../../../../../plugin-sdk/src/svelte/index';
  import { useCalibrations } from '../../../use-calibrations.svelte.ts';
  import { refreshGallery } from '../../../shaper-state.svelte.ts';
  import Icon from '../../../../shared/icons/Icon.svelte';

  const api = usePluginApi();
  const i18n = api.i18n;
  const store = useCalibrations(api);

  const DEFAULT_CMD: Record<'X' | 'Y', string> = {
    X: 'generate_x_shaper_graph',
    Y: 'generate_y_shaper_graph',
  };

  function readSettings(): void {
    store.shaperState.cmd.X = api.settings.get<string>('shaperCmdX') ?? DEFAULT_CMD.X;
    store.shaperState.cmd.Y = api.settings.get<string>('shaperCmdY') ?? DEFAULT_CMD.Y;
    store.shaperState.beltsEnabled = api.settings.get<boolean>('beltsEnabled') ?? false;
  }

  $effect(() => {
    readSettings();
    const off = api.settings.onChange(readSettings);
    const offPrinter = api.onPrinterChange(readSettings);
    return () => {
      off();
      offPrinter();
    };
  });

  function setCmd(v: string): void {
    store.shaperState.cmd[store.shaperState.axis] = v;
    api.settings.set(store.shaperState.axis === 'X' ? 'shaperCmdX' : 'shaperCmdY', v);
  }

  function toggleBelts(e: Event): void {
    const on = (e.currentTarget as HTMLInputElement).checked;
    store.shaperState.beltsEnabled = on;
    api.settings.set('beltsEnabled', on);
  }
</script>

<div class="toolbar">
  <label class="cmd-select">
    <span class="lbl">{i18n.t('calibrations.shaper.shellCmd')} {store.shaperState.axis}</span>
    <select class="select" value={store.shaperState.cmd[store.shaperState.axis]} onchange={(e) => setCmd(e.currentTarget.value)}>
      {#if !store.state.shellCommands.includes(store.shaperState.cmd[store.shaperState.axis])}
        <option value={store.shaperState.cmd[store.shaperState.axis]}>{store.shaperState.cmd[store.shaperState.axis]}</option>
      {/if}
      {#each store.state.shellCommands as c (c)}
        <option value={c}>{c}</option>
      {/each}
    </select>
  </label>

  <button class="icon-btn" onclick={() => void refreshGallery(store.shaperState, api.moonraker())} title={i18n.t('calibrations.shaper.refreshGallery')}>
    <Icon name="refresh" size={14} />
  </button>

  <span class="spacer"></span>

  <label class="switch" title={i18n.t('calibrations.belts.enableHint')}>
    <input type="checkbox" checked={store.shaperState.beltsEnabled} onchange={toggleBelts} />
    <span>{i18n.t('calibrations.belts.short')}</span>
  </label>
</div>

<style>
  .toolbar { display: flex; align-items: center; gap: var(--space-sm); flex-wrap: wrap; }
  .cmd-select { display: flex; align-items: center; gap: var(--space-xs); }
  .lbl { font-size: var(--font-size-sm); color: var(--text-muted); white-space: nowrap; }
  .select {
    background: var(--bg-surface);
    color: var(--text-primary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    font-size: var(--font-size-sm);
    padding: 2px var(--space-xs);
    max-width: 220px;
  }
  .icon-btn {
    display: flex; align-items: center; justify-content: center;
    width: 28px; height: 28px; border: none; border-radius: var(--radius-sm);
    background: transparent; color: var(--text-muted); cursor: pointer;
  }
  .icon-btn:hover { background: var(--bg-surface-hover); color: var(--text-primary); }
  .spacer { flex: 1; }
  .switch {
    display: flex; align-items: center; gap: var(--space-xs);
    font-size: var(--font-size-sm); color: var(--text-secondary); cursor: pointer;
  }
  .switch input { cursor: pointer; }
</style>