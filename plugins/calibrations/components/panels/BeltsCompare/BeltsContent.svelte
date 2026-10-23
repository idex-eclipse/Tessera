<script lang="ts">
  import { usePluginApi } from '../../../../../plugin-sdk/src/svelte/index';
  import { useCalibrations } from '../../../use-calibrations.svelte.ts';
  import { gcode, runGcode } from '../../../commands.ts';
  import {
    refreshGallery, takeBaseline, diffArtifacts,
  } from '../../../shaper-state.svelte.ts';
  import Icon from '../../../../shared/icons/Icon.svelte';

  const api = usePluginApi();
  const i18n = api.i18n;
  const store = useCalibrations(api);

  const DEFAULT_BELTS_CMD = 'generate_belts_graph';

  // ref для автопрокрутки belt-log
  let beltLogEl = $state<HTMLPreElement | null>(null);

  // Оси по документации Klipper «Testing custom axes»
  const BELT_AXES: Record<'corexy' | 'delta', string[]> = {
    corexy: ['1,1', '1,-1'],
    delta: ['0,1', '-0.866025404,-0.5', '0.866025404,-0.5'],
  };

  type SelAction = 'tests' | 'pipe';
  let selected = $state<SelAction>('tests');

  let detected = $derived(store.state.kinematics);

  let effective = $derived.by<'corexy' | 'delta' | 'none'>(() => {
    if (store.shaperState.kinematics !== 'auto') return store.shaperState.kinematics;
    return detected === 'corexy' || detected === 'delta' ? detected : 'none';
  });

  let axes = $derived(effective === 'none' ? [] : BELT_AXES[effective]);
  let beltsCmd = $derived(store.shaperState.beltsCmd || DEFAULT_BELTS_CMD);

  let isPrinting = $derived(
    store.state.printState === 'printing' || store.state.printState === 'paused',
  );
  let notHomed = $derived(store.state.homedAxes !== 'xyz');

  /** Единый источник: превью и отправка читают один derived. */
  let lines = $derived.by<string[]>(() => {
    const tests = axes.map((ax) => gcode.testResonances(ax, { output: 'raw_data' }));
    return selected === 'pipe' ? [...tests, gcode.waitComplete, gcode.pauseForData, gcode.runShellCommand(beltsCmd)] : tests;
  });

  $effect(() => {
    void store.shaperState.beltLog.length;
    if (beltLogEl) {
      beltLogEl.scrollTop = beltLogEl.scrollHeight;
    }
  });

  async function run(): Promise<void> {
    if (store.shaperState.busy !== '' || isPrinting || notHomed || effective === 'none') return;
    const withGraph = selected === 'pipe';
    store.shaperState.busy = withGraph ? 'beltsPipe' : 'belts';
    store.shaperState.beltLog = [];
    store.shaperState.beltArtifacts = [];
    if (withGraph) takeBaseline(store.shaperState);
    try {
      for (const ax of axes) {
        await runGcode(api.moonraker(), gcode.testResonances(ax, { output: 'raw_data' }));
      }
      if (withGraph) {
        await runGcode(api.moonraker(), gcode.runShellCommand(beltsCmd));
        await refreshGallery(store.shaperState, api.moonraker());
        store.shaperState.beltArtifacts = diffArtifacts(store.shaperState);
      }
    } catch (e) {
      console.error('[calibrations] belts run failed:', e);
    } finally {
      store.shaperState.busy = '';
    }
  }
</script>

<div class="belts">
  <div class="row">
    <span class="chip mono">{i18n.t('calibrations.belts.detected', { k: detected })}</span>
  </div>

  {#if effective === 'none'}
    <p class="hint warn">{i18n.t('calibrations.belts.notDetected')}</p>
  {:else}
    <!-- селектор действия -->
    <div class="sel-row">
      <button
        class="sel-btn"
        class:active={selected === 'tests'}
        disabled={store.shaperState.busy !== ''}
        onclick={() => (selected = 'tests')}
      >
        {i18n.t('calibrations.belts.run')}
      </button>
      <button
        class="sel-btn"
        class:active={selected === 'pipe'}
        disabled={store.shaperState.busy !== ''}
        onclick={() => (selected = 'pipe')}
      >
        {i18n.t('calibrations.belts.runGraph')}
      </button>
    </div>

    <!-- единая панель отправки -->
    <div class="send-block">
      <code class="gcode mono" title={lines.join('\n')}>
        {#each lines as l, i (i)}<span class="gline">{i + 1}. {l}</span>{/each}
      </code>
      <div class="btn-row">
        <button
          class="btn primary"
          disabled={store.shaperState.busy !== '' || isPrinting || notHomed}
          onclick={run}
        >
          {#if store.shaperState.busy !== ''}
            <Icon name="loader" size={14} /> {i18n.t('calibrations.running')}
          {:else}
            <Icon name="play" size={14} /> {i18n.t('calibrations.run')}
          {/if}
        </button>
      </div>
    </div>
  {/if}

  {#if store.shaperState.beltLog.length > 0}
    <pre class="log" bind:this={beltLogEl}>{store.shaperState.beltLog.join('\n')}</pre>
  {/if}

  {#if notHomed}
    <p class="hint warn">{i18n.t('calibrations.shaper.notHomedHint')}</p>
  {/if}
</div>

<style>
  .belts { display: flex; flex-direction: column; gap: var(--space-sm); }
  .row { display: flex; align-items: center; gap: var(--space-md); flex-wrap: wrap; }
  .hint { margin: 0; font-size: var(--font-size-sm); color: var(--text-muted); }
  .hint.warn { color: var(--warning); }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .chip {
    padding: 1px 8px; border-radius: 999px; background: var(--bg-surface-hover);
    border: 1px solid var(--border-color); font-size: var(--font-size-sm); color: var(--text-secondary);
  }

  .sel-row { display: flex; gap: var(--space-xs); flex-wrap: wrap; }
  .sel-btn {
    display: inline-flex; align-items: center; gap: var(--space-xs);
    padding: var(--space-xs) var(--space-sm);
    border: 1px solid var(--border-color); border-radius: var(--radius-sm);
    background: transparent; color: var(--text-secondary);
    font-size: var(--font-size-sm); cursor: pointer;
  }
  .sel-btn:hover:not(:disabled) { background: var(--bg-surface-hover); }
  .sel-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .sel-btn.active { background: var(--bg-surface-active); color: var(--accent); border-color: var(--accent); }

  .send-block { display: flex; flex-direction: column; gap: var(--space-xs); }
  .gcode {
    display: block;
    padding: var(--space-xs) var(--space-sm);
    background: var(--bg-surface-hover-no-override);
    border: 1px dashed var(--border-color);
    border-radius: var(--radius-sm);
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
    white-space: pre-wrap;
    word-break: break-all;
    user-select: text;
  }
  .gline { display: block; }

  .btn-row { display: flex; gap: var(--space-xs); flex-wrap: wrap; }
  .btn {
    display: inline-flex; align-items: center; justify-content: center; gap: var(--space-xs);
    padding: var(--space-xs) var(--space-md); border: 1px solid var(--border-color);
    border-radius: var(--radius-sm); background: var(--bg-surface-hover);
    color: var(--text-primary); font-size: var(--font-size-sm); cursor: pointer;
  }
  .btn:hover:not(:disabled) { background: var(--bg-surface-active); }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-text); }

  .log {
    margin: 0; max-height: 140px; overflow-y: auto; padding: var(--space-sm);
    background: var(--bg-surface-hover); border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 11px; color: var(--text-secondary);
    white-space: pre-wrap; word-break: break-word;
  }

  @keyframes spin { to { transform: rotate(360deg); } }
</style>