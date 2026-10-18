<script lang="ts">
  import { usePluginApi } from '../../../../../plugin-sdk/src/svelte/index';

  import Icon from '../../../../shared/icons/Icon.svelte';
  import MeshViewer3D from './components/MeshViewer3D.svelte';
  import SaveProfileDialog from './components/SaveProfileDialog.svelte';

  import { useBedMesh } from '../../../use-bed-mesh.svelte.ts';
  import { gcode, runGcode } from '../../../commands.ts';
  import { buildGrid, computeStats, formatMm, deviationRgb } from './mesh-math.ts';

  import ProfilesPanel from './components/ProfilesPanel.svelte';
  import ToolsPanel from './components/ToolsPanel.svelte';

  const api = usePluginApi();
  const i18n = api.i18n;
  const store = useBedMesh(api);
  // KlipperNotReady гейт уже на уровне CalibrationsPage.svelte

  // ------------------------------------------------------------------
  // настройки отображения (api.settings, sync-aware)
  // ------------------------------------------------------------------

  let exaggeration = $state(10);
  let interpolated = $state(true);
  let basePlane = $state(true);
  let wireframe = $state(false);

  function readSettings(): void {
    exaggeration = api.settings.get<number>('view:exaggeration') ?? 10;
    interpolated = api.settings.get<boolean>('view:interpolated') ?? true;
    basePlane = api.settings.get<boolean>('view:basePlane') ?? true;
    wireframe = api.settings.get<boolean>('view:wireframe') ?? false;
  }

  readSettings();

  $effect(() => {
    return api.settings.onChange(readSettings);
  });

  function setExaggeration(v: number): void {
    exaggeration = v;
    api.settings.set('view:exaggeration', v);
  }

  function toggleInterpolated(): void {
    interpolated = !interpolated;
    api.settings.set('view:interpolated', interpolated);
  }

  function toggleBasePlane(): void {
    basePlane = !basePlane;
    api.settings.set('view:basePlane', basePlane);
  }

  function toggleWireframe(): void {
    wireframe = !wireframe;
    api.settings.set('view:wireframe', wireframe);
  }

  // ------------------------------------------------------------------
  // данные для вьюера
  // ------------------------------------------------------------------

  let matrix = $derived(
    interpolated ? store.mesh.meshMatrix : store.mesh.probedMatrix,
  );
  let grid = $derived(buildGrid(store.mesh.meshMin, store.mesh.meshMax, matrix));
  let stats = $derived(computeStats(matrix));

  // ------------------------------------------------------------------
  // действия
  // ------------------------------------------------------------------

  type BusyAction = '' | 'calibrate' | 'clear' | 'save';

  let busy = $state<BusyAction>('');
  let saveOpen = $state(false);

  async function exec(action: BusyAction, script: string): Promise<boolean> {
    if (busy) return false;
    busy = action;
    try {
      await runGcode(api.moonraker(), script);
      return true;
    } catch (e) {
      console.error('[bed-mesh] gcode failed:', script, e);
      return false;
    } finally {
      busy = '';
    }
  }

  /** Команды, мутирующие bed_mesh: после успеха — прямой refresh. */
  async function execAndRefresh(action: BusyAction, script: string): Promise<void> {
    if (await exec(action, script)) await store.refresh();
  }

  function saveProfile(name: string): void {
    saveOpen = false;
    void execAndRefresh('save', gcode.bedMeshProfileSave(name));
  }

  // ------------------------------------------------------------------
  // шкала-клиппинг: один трек, два ползунка
  // ------------------------------------------------------------------

  let clipMin = $state(0);
  let clipMax = $state(0);

  let dir = $state<'ltr' | 'rtl'>('ltr');

  function readDir(): void {
    dir = document.documentElement.getAttribute('dir') === 'rtl' ? 'rtl' : 'ltr';
  }

  readDir();

  $effect(() => {
    return api.onLocaleChange(() => readDir());
  });

  // при смене сетки/режима — сброс на полный диапазон
  $effect(() => {
    if (!stats) return;
    clipMin = stats.min;
    clipMax = stats.max;
  });

  function resetClip(): void {
    if (!stats) return;
    clipMin = stats.min;
    clipMax = stats.max;
  }

  // ползунки не проходят друг сквозь друга
  function onClipMinInput(): void {
    if (clipMin > clipMax) clipMin = clipMax;
  }

  function onClipMaxInput(): void {
    if (clipMax < clipMin) clipMax = clipMin;
  }

  // градиентная подложка шкалы (та же палитра, что у карты)
  let scaleGradient = $derived.by(() => {
    const stops: string[] = [];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      const [r, g, b] = deviationRgb(t);
      stops.push(`rgb(${r}, ${g}, ${b}) ${(t * 100).toFixed(0)}%`);
    }
    return `linear-gradient(${dir === 'rtl' ? 'to left' : 'to right'}, ${stops.join(', ')})`;
  });

  let loPct = $derived.by(() => {
    if (!stats || stats.max <= stats.min) return 0;
    return ((clipMin - stats.min) / (stats.max - stats.min)) * 100;
  });

  let hiPct = $derived.by(() => {
    if (!stats || stats.max <= stats.min) return 100;
    return ((clipMax - stats.min) / (stats.max - stats.min)) * 100;
  });

  // когда левый ползунок у правого края — поднимаем его выше по z,
  // иначе его перекрывает правый input
  let minOnTop = $derived.by(() =>
    stats ? clipMin > (stats.min + stats.max) / 2 : false,
  );
</script>

<div class="mesh-content">
  <!-- -------------------------------------------- Карта стола -->
  <section class="panel panel-map">
    <header class="panel-header">
      <span class="panel-title">{i18n.t('bedMesh.map.title')}</span>

      <div class="header-actions">
        <label class="check">
          {i18n.t('bedMesh.map.exaggeration')}
          <select
            class="select"
            value={String(exaggeration)}
            onchange={(e) => setExaggeration(Number((e.currentTarget as HTMLSelectElement).value))}
          >
            <option value="50">×50</option>
            <option value="75">×75</option>
            <option value="100">×100</option>
            <option value="125">×125</option>
            <option value="150">×150</option>
          </select>
        </label>

        <label class="check">
          <input type="checkbox" checked={interpolated} onchange={toggleInterpolated} />
          {i18n.t('bedMesh.map.interpolated')}
        </label>

        <label class="check">
          <input type="checkbox" checked={basePlane} onchange={toggleBasePlane} />
          {i18n.t('bedMesh.map.basePlane')}
        </label>

        <label class="check">
          <input type="checkbox" checked={wireframe} onchange={toggleWireframe} />
          {i18n.t('bedMesh.map.wireframe')}
        </label>

        <button
          class="btn"
          disabled={busy !== '' || !store.tools.profile}
          onclick={() => (saveOpen = true)}
          title={i18n.t('bedMesh.save.trigger')}
        >
          <Icon name="save" size={14} />
          {i18n.t('bedMesh.save.trigger')}
        </button>

        <button
          class="btn"
          disabled={busy !== '' || !store.tools.calibrate}
          onclick={() => execAndRefresh('calibrate', gcode.bedMeshCalibrate)}
        >
          {i18n.t('bedMesh.map.calibrate')}
        </button>

        <button
          class="icon-btn"
          disabled={busy !== '' || !store.tools.clear || !store.hasMesh}
          onclick={() => execAndRefresh('clear', gcode.bedMeshClear)}
          title={i18n.t('bedMesh.map.clear')}
        >
          <Icon name="delete" size={14} />
        </button>
      </div>
    </header>

    <div class="panel-body">
      <div class="stats">
        <span class="stat">
          <span class="stat-label">{i18n.t('bedMesh.map.profile')}:</span>
          {store.mesh.profileName || '—'}
        </span>
        <span class="stat">
          <span class="stat-label">{i18n.t('bedMesh.map.min')}:</span>
          {stats ? formatMm(stats.min) : '—'}
        </span>
        <span class="stat">
          <span class="stat-label">{i18n.t('bedMesh.map.max')}:</span>
          {stats ? formatMm(stats.max) : '—'}
        </span>
        <span class="stat">
          <span class="stat-label">{i18n.t('bedMesh.map.variance')}:</span>
          {stats ? formatMm(stats.variance) : '—'}
        </span>
      </div>

      {#if stats}
        <div class="scale-row">
          <span class="scale-label">{i18n.t('bedMesh.map.scale')}</span>
          <span class="scale-value">{clipMin.toFixed(2)}</span>

          <div class="dual-range">
            <div class="dr-track" style="background: {scaleGradient}"></div>

            <!-- затемнение отсечённых областей -->
            <div
              class="dr-dim"
              style="inset-inline-start: 0%; inset-inline-end: {100 - loPct}%"
            ></div>
            <div
              class="dr-dim"
              style="inset-inline-start: {hiPct}%; inset-inline-end: 0%"
            ></div>

            <input
              type="range"
              class="dr-input"
              style="z-index: {minOnTop ? 5 : 3}"
              min={stats.min}
              max={stats.max}
              step={0.01}
              bind:value={clipMin}
              oninput={onClipMinInput}
              aria-label={i18n.t('bedMesh.map.scale')}
            />
            <input
              type="range"
              class="dr-input"
              style="z-index: 4"
              min={stats.min}
              max={stats.max}
              step={0.01}
              bind:value={clipMax}
              oninput={onClipMaxInput}
              aria-label={i18n.t('bedMesh.map.scale')}
            />
          </div>

          <span class="scale-value">{clipMax.toFixed(2)}</span>

          <button
            class="icon-btn"
            onclick={resetClip}
            title={i18n.t('bedMesh.map.clipReset')}
          >
            <Icon name="refresh" size={14} />
          </button>
        </div>
      {/if}

      <div class="viewer-wrap">
        {#if store.hasMesh && grid && stats}
          <MeshViewer3D
            {grid}
            {stats}
            {exaggeration}
            clipMin={clipMin}
            clipMax={clipMax}
            showBasePlane={basePlane}
            showWireframe={wireframe}
          />
        {:else}
          <p class="empty">{i18n.t('bedMesh.widget.noMesh')}</p>
        {/if}
      </div>
    </div>
  </section>

  <!-- -------------------------------------------- правая колонка -->
  <div class="side-col">
    <section class="panel">
      <header class="panel-header">
        <span class="panel-title">{i18n.t('bedMesh.profiles.title')}</span>
      </header>
      <div class="panel-body">
        <ProfilesPanel store={store} />
      </div>
    </section>

    <section class="panel">
      <header class="panel-header">
        <span class="panel-title">{i18n.t('bedMesh.tools.title')}</span>
      </header>
      <div class="panel-body">
        <ToolsPanel store={store} />
      </div>
    </section>
  </div>
</div>

<SaveProfileDialog
  open={saveOpen}
  existing={store.profileNames}
  defaultName={store.mesh.profileName}
  busy={busy === 'save'}
  onSave={saveProfile}
  onClose={() => (saveOpen = false)}
/>

<style>
  .mesh-content {
    flex: 1;
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(300px, 380px);
    gap: var(--space-md);
    align-items: stretch;
    min-height: 0;
  }

  .side-col {
    display: flex;
    flex-direction: column;
    gap: var(--space-md);
    min-width: 0;
    min-height: 0;
  }

  .side-col > .panel {
    display: flex;
    flex-direction: column;
    min-height: 0;
  }

  .side-col > .panel:first-child {
    flex: 1;
  }

  .side-col .panel-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
  }

  .panel {
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-sm);
    overflow: hidden;
  }

  .panel-map {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
  }

  .panel-map .panel-body {
    flex: 1;
    min-height: 0;
  }

  .panel-header {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    padding: var(--space-sm) var(--space-md);
    border-bottom: 1px solid var(--border-color);
    flex-wrap: wrap;
  }

  .panel-title {
    flex: 1;
    min-width: 0;
    font-size: var(--font-size-md);
    font-weight: 600;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    flex-wrap: wrap;
    flex-shrink: 0;
  }

  .check {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
    white-space: nowrap;
  }

  .select {
    background: var(--bg-surface);
    color: var(--text-primary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    font-size: var(--font-size-sm);
    padding: 2px var(--space-xs);
  }

  .btn {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
    padding: var(--space-xs) var(--space-sm);
    border: none;
    border-radius: var(--radius-sm);
    background: var(--accent);
    color: var(--accent-text);
    font-size: var(--font-size-sm);
    font-weight: 500;
    cursor: pointer;
    transition: background var(--transition-fast);
  }

  .btn:hover {
    background: var(--accent-hover);
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .icon-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
  }

  .icon-btn:hover {
    background: var(--bg-surface-hover);
    color: var(--danger);
  }

  .icon-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .panel-body {
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
    padding: var(--space-md);
    flex: 1;
    min-height: 0;
  }

  .stats {
    display: flex;
    align-items: center;
    gap: var(--space-md);
    flex-wrap: wrap;
    flex-shrink: 0;
  }

  .stat {
    font-size: var(--font-size-sm);
    color: var(--text-primary);
    font-family: monospace;
  }

  .stat-label {
    color: var(--text-muted);
    margin-inline-end: var(--space-xs);
  }

  .viewer-wrap {
    position: relative;
    flex: 1;
    min-height: 320px;
    width: 100%;
  }

  .empty {
    color: var(--text-muted);
    text-align: center;
    padding: var(--space-lg);
  }

  .scale-row {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    flex-wrap: wrap;
    flex-shrink: 0;
  }

  .scale-label {
    font-size: var(--font-size-sm);
    color: var(--text-muted);
    white-space: nowrap;
  }

  .scale-value {
    font-family: monospace;
    font-size: var(--font-size-sm);
    color: var(--text-primary);
    min-width: 52px;
    text-align: center;
  }

  /* ---------- двухползунковая шкала ---------- */

  .dual-range {
    position: relative;
    flex: 1;
    min-width: 160px;
    height: 24px;
  }

  .dr-track {
    position: absolute;
    inset-inline: 0;
    top: 50%;
    transform: translateY(-50%);
    height: 8px;
    border-radius: 4px;
  }

  .dr-dim {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    height: 8px;
    border-radius: 4px;
    background: rgba(0, 0, 0, 0.55);
    pointer-events: none;
  }

  .dual-range input[type='range'] {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    margin: 0;
    background: transparent;
    -webkit-appearance: none;
    appearance: none;
    pointer-events: none;
  }

  .dual-range input[type='range']::-webkit-slider-runnable-track {
    background: transparent;
  }

  .dual-range input[type='range']::-moz-range-track {
    background: transparent;
  }

  .dual-range input[type='range']::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    pointer-events: auto;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--text-primary);
    border: 2px solid var(--bg-surface);
    box-shadow: 0 0 0 1px var(--border-color);
    cursor: pointer;
  }

  .dual-range input[type='range']::-moz-range-thumb {
    pointer-events: auto;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--text-primary);
    border: 2px solid var(--bg-surface);
    box-shadow: 0 0 0 1px var(--border-color);
    cursor: pointer;
  }

  @media (max-width: 900px) {
    .mesh-content {
      grid-template-columns: 1fr;
    }
  }
</style>