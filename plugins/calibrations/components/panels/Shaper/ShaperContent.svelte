<script lang="ts">
  import { usePluginApi } from '../../../../../plugin-sdk/src/svelte/index';
  import { useCalibrations } from '../../../use-calibrations.svelte.ts';
  import { gcode, runGcode } from '../../../commands.ts';
  import {
    shaper,
    resetShaperState,
    refreshGallery,
    takeBaseline,
    diffArtifacts,
    gallerySorted,
    loadPreview,
    releasePreview,
  } from '../../../shaper-state.svelte.ts';
  import BeltsContent from '../BeltsCompare/BeltsContent.svelte';
  import ShaperHelp from './ShaperPanelHelp.svelte';
  import BeltsHelp from '../BeltsCompare/BeltsHelp.svelte';
  import GraphsContent from '../ShaperGraph/GraphsContent.svelte';
  import GraphsHelp from '../ShaperGraph/GraphsPanelHelp.svelte';
  import HeaderHelp from '../../../../shared/header-help/HeaderHelp.svelte';
  import ConfirmDialog from '../../../../shared/confirm-dialog.svelte';
  import Icon from '../../../../shared/icons/Icon.svelte';

  const api = usePluginApi();
  const i18n = api.i18n;
  const store = useCalibrations(api);

  const DEFAULT_CMD: Record<'X' | 'Y', string> = {
    X: 'generate_x_shaper_graph',
    Y: 'generate_y_shaper_graph',
  };
  const DEFAULT_BELTS_CMD = 'generate_belts_graph';

  let saveOpen = $state(false);
  let shaperMenuOpen = $state(false);
  let beltsMenuOpen = $state(false);

  type SelAction = 'test' | 'calib' | 'pipe';
  let selected = $state<SelAction>('test');

  // settings-поля обеих панелей читаются здесь (меню шапок пишут туда же)
  $effect(() => {
    const readSettings = () => {
      shaper.cmd.X = api.settings.get<string>('shaperCmdX') ?? DEFAULT_CMD.X;
      shaper.cmd.Y = api.settings.get<string>('shaperCmdY') ?? DEFAULT_CMD.Y;
      shaper.kinematics = api.settings.get<'auto' | 'corexy' | 'delta'>('beltsKinematics') ?? 'auto';
      shaper.beltsCmd = api.settings.get<string>('beltsCmd') ?? DEFAULT_BELTS_CMD;
      shaper.beltsForceShow = api.settings.get<boolean>('beltsForceShow') ?? false;
    };
    readSettings();
    const offSettings = api.settings.onChange(readSettings);
    const offPrinter = api.onPrinterChange(() => {
      resetShaperState();
      readSettings();
      void refreshGallery(api);
    });
    void refreshGallery(api);
    return () => {
      offSettings();
      offPrinter();
      releasePreview();
    };
  });

  // закрытие меню по клику вне и по Esc
  $effect(() => {
    function onClick(e: MouseEvent) {
      const t = e.target as HTMLElement;
      if (!t.closest('[data-menu="shaper"]')) shaperMenuOpen = false;
      if (!t.closest('[data-menu="belts"]')) beltsMenuOpen = false;
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        shaperMenuOpen = false;
        beltsMenuOpen = false;
      }
    }
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('keydown', onKey);
    };
  });

  let isPrinting = $derived(
    store.state.printState === 'printing' || store.state.printState === 'paused',
  );
  let notHomed = $derived(store.state.homedAxes !== 'xyz');
  let items = $derived(gallerySorted());
  let currentCmd = $derived(shaper.cmd[shaper.axis] || DEFAULT_CMD[shaper.axis]);

  let detectedKinematics = $derived(store.state.kinematics);
  let beltsVisible = $derived.by(() => {
    const k = shaper.kinematics !== 'auto' ? shaper.kinematics : detectedKinematics;
    return k === 'corexy' || k === 'delta' || shaper.beltsForceShow;
  });

  // --- writers для меню шапок ---
  function setCmd(axis: 'X' | 'Y', v: string): void {
    shaper.cmd[axis] = v;
    api.settings.set(axis === 'X' ? 'shaperCmdX' : 'shaperCmdY', v);
  }
  function setBeltsForceShow(on: boolean): void {
    shaper.beltsForceShow = on;
    api.settings.set('beltsForceShow', on);
  }
  function setKinematics(v: 'auto' | 'corexy' | 'delta'): void {
    shaper.kinematics = v;
    api.settings.set('beltsKinematics', v);
  }
  function setBeltsCmd(v: string): void {
    shaper.beltsCmd = v;
    api.settings.set('beltsCmd', v);
  }

  // --- композеры строк ---
  function testScript(): string {
    const opts: { freqStart?: number; freqEnd?: number; hzPerSec?: number } = {};
    const fs = Number(shaper.freqStart);
    const fe = Number(shaper.freqEnd);
    const hz = Number(shaper.hzPerSec);
    if (shaper.freqStart.trim() !== '' && Number.isFinite(fs)) opts.freqStart = fs;
    if (shaper.freqEnd.trim() !== '' && Number.isFinite(fe)) opts.freqEnd = fe;
    if (shaper.hzPerSec.trim() !== '' && Number.isFinite(hz)) opts.hzPerSec = hz;
    return gcode.testResonances(shaper.axis, opts);
  }

  function calibrateScript(): string {
    let s = gcode.shaperCalibrate(shaper.axis);
    const types = shaper.shaperTypes.trim();
    if (types) s += ` SHAPER_TYPES=${types}`;
    return s;
  }

  /** Единый источник: превью и отправка читают один derived. */
  let lines = $derived.by<string[]>(() => {
    if (selected === 'test') return [testScript()];
    if (selected === 'calib') return [calibrateScript()];
    return [testScript(), gcode.waitComplete, gcode.pauseForData, gcode.runShellCommand(currentCmd)];
  });

  function beginRun(key: string): void {
    shaper.busy = key;
    shaper.runDone = false;
    shaper.sessionLog = [];
    shaper.fitted = [];
    shaper.recommended = null;
    shaper.lastArtifacts = [];
  }

  async function run(): Promise<void> {
    if (shaper.busy !== '' || isPrinting || notHomed) return;

    if (selected === 'pipe') {
      beginRun('pipe');
      takeBaseline();
      try {
        await runGcode(api.moonraker(), testScript());
        await runGcode(api.moonraker(), gcode.runShellCommand(currentCmd));
        await refreshGallery(api);
        shaper.lastArtifacts = diffArtifacts();
      } catch (e) {
        console.error('[calibrations] pipeline failed:', e);
      } finally {
        shaper.busy = '';
        shaper.runDone = true;
      }
      return;
    }

    beginRun(selected);
    try {
      await runGcode(api.moonraker(), lines[0] ?? '');
    } catch (e) {
      console.error('[calibrations] run failed:', lines[0], e);
    } finally {
      shaper.busy = '';
      shaper.runDone = true;
    }
  }

  async function applyRecommended(): Promise<void> {
    const rec = shaper.recommended;
    if (!rec || shaper.busy !== '') return;
    shaper.busy = 'apply';
    try {
      await runGcode(
        api.moonraker(),
        gcode.setInputShaper({
          [`SHAPER_TYPE_${shaper.axis}`]: rec.name,
          [`FREQ_${shaper.axis}`]: rec.freq,
        }),
      );
    } catch (e) {
      console.error('[calibrations] SET_INPUT_SHAPER failed:', e);
    } finally {
      shaper.busy = '';
    }
  }

  function confirmSave(): void {
    saveOpen = false;
    shaper.busy = 'save';
    runGcode(api.moonraker(), gcode.saveConfig())
      .catch((e) => console.error('[calibrations] SAVE_CONFIG failed:', e))
      .finally(() => {
        shaper.busy = '';
      });
  }

  function fmtTime(modified: number): string {
    return new Date(modified * 1000).toLocaleString();
  }
</script>

<div class="stack">
  <!-- ============ Панель Shapers ============ -->
  <section class="panel">
    <header class="panel-header">
      <span class="panel-title">{i18n.t('calibrations.section.shaper')}</span>
      <div class="header-actions">
        <div class="menu-wrap" data-menu="shaper">
          <button
            class="icon-btn"
            onclick={(e) => { e.stopPropagation(); shaperMenuOpen = !shaperMenuOpen; }}
            title={i18n.t('calibrations.shaper.settings')}
            aria-label={i18n.t('calibrations.shaper.settings')}
          >
            <Icon name="settings" size={14} />
          </button>
          {#if shaperMenuOpen}
            <div class="menu" role="menu">
              <label class="menu-item">
                <span class="menu-label">{i18n.t('calibrations.shaper.shellCmd')} X</span>
                <select
                  class="select"
                  value={shaper.cmd.X}
                  onchange={(e) => setCmd('X', e.currentTarget.value)}
                >
                  {#if !store.state.shellCommands.includes(shaper.cmd.X)}
                    <option value={shaper.cmd.X}>{shaper.cmd.X}</option>
                  {/if}
                  {#each store.state.shellCommands as c (c)}
                    <option value={c}>{c}</option>
                  {/each}
                </select>
              </label>

              <label class="menu-item">
                <span class="menu-label">{i18n.t('calibrations.shaper.shellCmd')} Y</span>
                <select
                  class="select"
                  value={shaper.cmd.Y}
                  onchange={(e) => setCmd('Y', e.currentTarget.value)}
                >
                  {#if !store.state.shellCommands.includes(shaper.cmd.Y)}
                    <option value={shaper.cmd.Y}>{shaper.cmd.Y}</option>
                  {/if}
                  {#each store.state.shellCommands.includes(shaper.cmd.Y) ? [] : [shaper.cmd.Y]}
                    <option value={shaper.cmd.Y}>{shaper.cmd.Y}</option>
                  {/each}
                  {#each store.state.shellCommands as c (c)}
                    <option value={c}>{c}</option>
                  {/each}
                </select>
              </label>

              <div class="menu-sep"></div>

              <label class="menu-item menu-switch">
                <input
                  type="checkbox"
                  checked={shaper.beltsForceShow}
                  onchange={(e) => setBeltsForceShow(e.currentTarget.checked)}
                />
                <span>{i18n.t('calibrations.belts.forceShow')}</span>
              </label>
            </div>
          {/if}
        </div>

        <HeaderHelp title={i18n.t('calibrations.section.shaper')}>
          <ShaperHelp />
        </HeaderHelp>
      </div>
    </header>

    <div class="panel-body">
      <!-- параметры команд (кормят превью) -->
      <div class="row controls">
        <label class="field">
          <span class="label">{i18n.t('calibrations.shaper.axis')}</span>
          <select class="select" bind:value={shaper.axis} disabled={shaper.busy !== ''}>
            <option value="X">X</option>
            <option value="Y">Y</option>
          </select>
        </label>
        <label class="field">
          <span class="label">{i18n.t('calibrations.shaper.freqStart')}</span>
          <input class="input" type="number" step="0.1" placeholder="5" bind:value={shaper.freqStart} disabled={shaper.busy !== ''} />
        </label>
        <label class="field">
          <span class="label">{i18n.t('calibrations.shaper.freqEnd')}</span>
          <input class="input" type="number" step="0.1" placeholder="133.3" bind:value={shaper.freqEnd} disabled={shaper.busy !== ''} />
        </label>
        <label class="field">
          <span class="label">{i18n.t('calibrations.shaper.hzPerSec')}</span>
          <input class="input" type="number" step="0.1" placeholder="1" bind:value={shaper.hzPerSec} disabled={shaper.busy !== ''} />
        </label>
        <label class="field">
          <span class="label">{i18n.t('calibrations.shaper.shaperTypes')}</span>
          <input class="input" type="text" placeholder="mzv, ei" bind:value={shaper.shaperTypes} disabled={shaper.busy !== ''} />
        </label>
      </div>

      {#if notHomed}
        <p class="hint warn">{i18n.t('calibrations.shaper.notHomedHint')}</p>
      {/if}

      <!-- селектор действия -->
      <div class="sel-row">
        <button class="sel-btn" class:active={selected === 'test'} disabled={shaper.busy !== ''} onclick={() => (selected = 'test')}>
          {i18n.t('calibrations.shaper.test')}
        </button>
        <button class="sel-btn" class:active={selected === 'calib'} disabled={shaper.busy !== ''} onclick={() => (selected = 'calib')}>
          {i18n.t('calibrations.shaper.calibrate')}
        </button>
        <button class="sel-btn" class:active={selected === 'pipe'} disabled={shaper.busy !== ''} onclick={() => (selected = 'pipe')}>
          {i18n.t('calibrations.shaper.testAndGraph')}
        </button>
      </div>

      <!-- единая панель отправки -->
      <div class="send-block">
        <code class="gcode mono" title={lines.join('\n')}>
          {#if lines.length === 1}
            {lines[0]}
          {:else}
            {#each lines as l, i (i)}<span class="gline">{i + 1}. {l}</span>{/each}
          {/if}
        </code>
        <div class="btn-row">
          <button class="btn primary" disabled={shaper.busy !== '' || isPrinting || notHomed} onclick={run}>
            {#if shaper.busy !== ''}
              <Icon name="loader" size={14} /> {i18n.t('calibrations.running')}
            {:else}
              <Icon name="play" size={14} /> {i18n.t('calibrations.run')}
            {/if}
          </button>
        </div>
      </div>

      <!-- live-чипы -->
      {#if shaper.fitted.length > 0 || shaper.recommended}
        <div class="chips">
          {#each shaper.fitted as f (`${f.name}-${f.freq}`)}
            <span class="chip mono">{f.name} {f.freq.toFixed(1)}Hz</span>
          {/each}
          {#if shaper.recommended}
            <span class="chip accent mono">
              {i18n.t('calibrations.shaper.recommended')}: {shaper.recommended.name} @ {shaper.recommended.freq.toFixed(1)}Hz
            </span>
          {/if}
        </div>
      {/if}

      <!-- итоги прогона -->
      {#if shaper.runDone}
        {#if shaper.fitted.length > 0}
          <table class="table">
            <thead>
              <tr>
                <th>{i18n.t('calibrations.shaper.table.shaper')}</th>
                <th>{i18n.t('calibrations.shaper.table.freq')}</th>
                <th>{i18n.t('calibrations.shaper.table.vib')}</th>
                <th>{i18n.t('calibrations.shaper.table.smooth')}</th>
              </tr>
            </thead>
            <tbody>
              {#each shaper.fitted as f (`row-${f.name}-${f.freq}`)}
                <tr class:rec={shaper.recommended?.name === f.name}>
                  <td>{f.name}</td>
                  <td class="mono">{f.freq.toFixed(1)}</td>
                  <td class="mono">{f.vib.toFixed(1)}%</td>
                  <td class="mono">{f.smooth.toFixed(3)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}

        <div class="row btn-row">
          <button class="btn" disabled={!shaper.recommended || shaper.busy !== ''} onclick={applyRecommended}>
            {i18n.t('calibrations.shaper.apply')}
          </button>
          <button class="btn primary" disabled={shaper.busy !== '' || isPrinting} onclick={() => (saveOpen = true)}>
            <Icon name="save" size={14} />
            {i18n.t('calibrations.saveConfig')}
          </button>
          {#if !shaper.recommended}
            <span class="chip warn-chip">{i18n.t('calibrations.shaper.verboseHint')}</span>
          {/if}
        </div>
      {/if}

      <!-- session-log -->
      {#if shaper.sessionLog.length > 0}
        <div class="log">
          <span class="label">{i18n.t('calibrations.shaper.sessionLog')}</span>
          <pre>
            {#each shaper.sessionLog as line (line)}
              <span class:err={line.startsWith('!!')}>{line}</span>
            {/each}
          </pre>
        </div>
      {/if}
    </div>
  </section>

  <!-- ============ Панель Belts (авто по кинематике) ============ -->
  {#if beltsVisible}
    <section class="panel">
      <header class="panel-header">
        <span class="panel-title">{i18n.t('calibrations.belts.title')}</span>
        <div class="header-actions">
          <div class="menu-wrap" data-menu="belts">
            <button
              class="icon-btn"
              onclick={(e) => { e.stopPropagation(); beltsMenuOpen = !beltsMenuOpen; }}
              title={i18n.t('calibrations.shaper.settings')}
              aria-label={i18n.t('calibrations.shaper.settings')}
            >
              <Icon name="settings" size={14} />
            </button>
            {#if beltsMenuOpen}
              <div class="menu" role="menu">
                <label class="menu-item">
                  <span class="menu-label">{i18n.t('calibrations.belts.kinematics')}</span>
                  <select
                    class="select"
                    value={shaper.kinematics}
                    onchange={(e) => setKinematics(e.currentTarget.value as 'auto' | 'corexy' | 'delta')}
                  >
                    <option value="auto">{i18n.t('calibrations.belts.auto')}</option>
                    <option value="corexy">CoreXY</option>
                    <option value="delta">Delta</option>
                  </select>
                </label>

                <label class="menu-item">
                  <span class="menu-label">{i18n.t('calibrations.belts.cmd')}</span>
                  <select
                    class="select"
                    value={shaper.beltsCmd}
                    onchange={(e) => setBeltsCmd(e.currentTarget.value)}
                  >
                    {#if !store.state.shellCommands.includes(shaper.beltsCmd)}
                      <option value={shaper.beltsCmd}>{shaper.beltsCmd}</option>
                    {/if}
                    {#each store.state.shellCommands as c (c)}
                      <option value={c}>{c}</option>
                    {/each}
                  </select>
                </label>
              </div>
            {/if}
          </div>

          <HeaderHelp title={i18n.t('calibrations.belts.title')}>
            <BeltsHelp />
          </HeaderHelp>
        </div>
      </header>

      <div class="panel-body">
        <BeltsContent />
      </div>
    </section>
  {/if}

  <!-- ============ Панель Graphs ============ -->
  <section class="panel">
    <header class="panel-header">
      <span class="panel-title">{i18n.t('calibrations.graphs.title')}</span>
      <div class="header-actions">
        <button
          class="icon-btn"
          onclick={() => void refreshGallery(api)}
          title={i18n.t('calibrations.shaper.refreshGallery')}
        >
          <Icon name="refresh" size={14} />
        </button>
        <HeaderHelp title={i18n.t('calibrations.graphs.title')}>
          <GraphsHelp />
        </HeaderHelp>
      </div>
    </header>

    <div class="panel-body">
      <GraphsContent />
    </div>
  </section>
</div>

{#if saveOpen}
  <ConfirmDialog
    open={saveOpen}
    title={i18n.t('calibrations.shaper.saveConfirmTitle')}
    message={i18n.t('calibrations.shaper.saveConfirmText')}
    confirmLabel={i18n.t('calibrations.shaper.saveConfig')}
    danger={true}
    onConfirm={confirmSave}
    onClose={() => (saveOpen = false)}
  />
{/if}

<style>
  .stack { display: flex; flex-direction: column; gap: var(--space-md); }

  .panel {
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-sm);
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
  .panel-header {
    display: flex; align-items: center; gap: var(--space-sm);
    padding: var(--space-sm) var(--space-md);
    border-bottom: 1px solid var(--border-color);
  }
  .panel-title {
    flex: 1; min-width: 0;
    font-size: var(--font-size-md); font-weight: 600; color: var(--text-primary);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .header-actions { display: flex; align-items: center; gap: var(--space-xs); flex-shrink: 0; }
  .panel-body {
    padding: var(--space-md);
    display: flex; flex-direction: column; gap: var(--space-sm);
  }

  .row { display: flex; align-items: center; gap: var(--space-sm); flex-wrap: wrap; }
  .controls { align-items: flex-end; }
  .field { display: flex; flex-direction: column; gap: 2px; }
  .label { font-size: var(--font-size-sm); color: var(--text-secondary); }
  .select, .input {
    background: var(--bg-surface); color: var(--text-primary);
    border: 1px solid var(--border-color); border-radius: var(--radius-sm);
    font-size: var(--font-size-sm); padding: var(--space-xs) var(--space-sm);
  }
  .input { width: 92px; }
  .hint { margin: 0; color: var(--text-muted); font-size: var(--font-size-sm); }
  .hint.warn { color: var(--warning); }

  /* селектор действий */
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

  /* единая панель отправки */
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

  .btn-row { gap: var(--space-xs); }
  .btn {
    display: inline-flex; align-items: center; justify-content: center; gap: var(--space-xs);
    padding: var(--space-xs) var(--space-md); border: 1px solid var(--border-color);
    border-radius: var(--radius-sm); background: var(--bg-surface-hover);
    color: var(--text-primary); font-size: var(--font-size-sm); cursor: pointer;
  }
  .btn:hover:not(:disabled) { background: var(--bg-surface-active); }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn.primary { background: var(--accent); border-color: var(--accent); color: #fff; }

  .chips { display: flex; gap: var(--space-xs); flex-wrap: wrap; }
  .chip {
    padding: 1px 8px; border-radius: 999px; background: var(--bg-surface-hover);
    border: 1px solid var(--border-color); font-size: var(--font-size-sm); color: var(--text-secondary);
  }
  .chip.accent { border-color: var(--accent); color: var(--accent); font-weight: 600; }
  .chip.warn-chip { border-color: var(--warning); color: var(--warning); }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }

  .table { width: 100%; border-collapse: collapse; font-size: var(--font-size-sm); }
  .table th, .table td {
    padding: var(--space-xs) var(--space-sm); text-align: left;
    border-bottom: 1px solid var(--border-color);
  }
  .table th { color: var(--text-muted); font-weight: 500; font-size: var(--font-size-sm); text-transform: uppercase; letter-spacing: 0.04em; }
  .table tr.rec td { color: var(--accent); font-weight: 600; }

  .log { display: flex; flex-direction: column; gap: var(--space-xs); }
  .log pre {
    margin: 0; max-height: 160px; overflow-y: auto; padding: var(--space-sm);
    background: var(--bg-surface-hover); border: 1px solid var(--border-color);
    border-radius: var(--radius-sm); font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: var(--font-size-sm); color: var(--text-secondary); white-space: pre-wrap; word-break: break-word;
  }
  .log pre .err { color: var(--danger); }

  .icon-btn {
    display: flex; align-items: center; justify-content: center;
    width: 28px; height: 28px; border: none; border-radius: var(--radius-sm);
    background: transparent; color: var(--text-muted); cursor: pointer;
  }
  .icon-btn:hover { background: var(--bg-surface-hover); color: var(--text-primary); }

  .menu-wrap { position: relative; }
  .menu {
    position: absolute; top: calc(100% + 4px); right: 0; z-index: 10;
    min-width: 260px; padding: var(--space-xs);
    background: var(--bg-surface); border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-md, 0 4px 12px rgba(0, 0, 0, 0.15));
    display: flex; flex-direction: column; gap: 2px;
  }
  .menu-item {
    display: flex; align-items: center; gap: var(--space-sm);
    padding: var(--space-xs) var(--space-sm); border-radius: var(--radius-sm);
    font-size: var(--font-size-sm); color: var(--text-primary);
  }
  .menu-item:hover { background: var(--bg-surface-hover); }
  .menu-item .menu-label {
    flex: 1; min-width: 0; color: var(--text-secondary);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .menu-item .select { width: auto; min-width: 140px; max-width: 220px; }

  .menu-sep { height: 1px; background: var(--border-color); margin: 4px 0; }
  .menu-item.menu-switch { cursor: pointer; }
  .menu-item.menu-switch input { cursor: pointer; }

  @keyframes spin { to { transform: rotate(360deg); } }
</style>