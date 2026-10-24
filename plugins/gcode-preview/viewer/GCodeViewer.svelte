<script lang="ts">
  import { usePluginApi } from '../../../plugin-sdk/src/svelte/index';

  import ViewerCanvas2D from './ViewerCanvas2D.svelte';
  import ViewerCanvas3D from './ViewerCanvas3D.svelte';
  import type { ParsedGcode } from './parse-gcode';

  import { useExcludeObjects } from '../../shared/exclude-objects/use-exclude-objects.svelte';
  import { usePreviewCommands } from './preview-ui-state.svelte';

  const api = usePluginApi();
  const excludeStore = useExcludeObjects(api);

  let {
    parsed,
    progressSeg = null,
    allow3d = true,
  }: {
    parsed: ParsedGcode;
    progressSeg?: number | null;
    allow3d?: boolean;
  } = $props();

  const i18n = api.i18n;

  let layer = $state(0);
  let showTravel = $state(false);
  let showPrev = $state(false);
  let showNext = $state(false);
  let showBounds = $state(true);
  let colorMode = $state<'extruder' | 'type'>('extruder');
  let mode = $state<'2d' | '3d'>('2d');

  $effect(() => {
    void parsed;
    layer = Math.max(0, parsed.layerZ.length - 1);
    colorMode = parsed.extruderCount > 1 ? 'extruder' : 'type';
  });

  let layerZ = $derived(parsed.layerZ[layer] ?? 0);

  // Стабильная ширина числовых частей лейбла: без неё тулбар «дышит»
  // на переходах 9→10 слоёв / Z 9.90→10.90, а flex-слайдер меняет ширину
  // трека — thumb дёргается. min-width = ширина САМОГО длинного варианта.
  let countWidth = $derived(String(parsed.layerZ.length).length * 2 + 1); // «123/456»
  let zWidth = $derived.by(() => {
    const maxZ = parsed.layerZ[parsed.layerZ.length - 1] ?? 0;
    return Math.max(4, String(maxZ.toFixed(2)).length); // «123.45»
  });

  function onSliderWheel(e: WheelEvent): void {
    e.preventDefault();
    const max = Math.max(0, parsed.layerZ.length - 1);
    const dir = e.deltaY < 0 ? 1 : -1; // колесо вверх = следующий слой
    layer = Math.min(max, Math.max(0, layer + dir));
  }

  // ---- follow print: слой едет за прогрессом; ручное движение слоёв
  // ---- ставит слежение на паузу 10с, потом оно само возобновляется
  let follow = $state(api.settings.get<boolean>('gcodePreview.follow') ?? true);
  let followPausedUntil = $state(0);

  function setFollow(v: boolean): void {
    follow = v;
    api.settings.set('gcodePreview.follow', v);
  }

  function pauseFollow(): void {
    followPausedUntil = Date.now() + 10_000;
  }

  $effect(() => {
    if (!follow || progressSeg == null) return;
    if (Date.now() < followPausedUntil) return;
    const l = parsed.layers[progressSeg] ?? 0;
    if (l !== layer) layer = l;
  });

  // Команды hotkeys (Alt+PageUp/PageDown, Alt+Home/End, Alt+T/B/M/F/C)
  usePreviewCommands((c) => {
    const max = Math.max(0, parsed.layerZ.length - 1);
    switch (c.name) {
      case 'layer-step':
        pauseFollow();
        layer = Math.min(max, Math.max(0, layer + c.amount));
        break;
      case 'layer-first':
        pauseFollow();
        layer = 0;
        break;
      case 'layer-last':
        pauseFollow();
        layer = max;
        break;
      case 'toggle-travel':
        showTravel = !showTravel;
        break;
      case 'toggle-bounds':
        showBounds = !showBounds;
        break;
      case 'toggle-mode':
        if (allow3d) mode = mode === '2d' ? '3d' : '2d';
        break;
      case 'toggle-follow':
        if (progressSeg != null) setFollow(!follow);
        break;
      case 'toggle-color':
        colorMode = colorMode === 'extruder' ? 'type' : 'extruder';
        break;
    }
  });

  let noObjectsHint = $derived(
    excludeStore.available && excludeStore.objects.length === 0 && parsed.objects.length === 0,
  );
</script>

<div class="viewer">
  <div class="viewer-toolbar">
    {#if allow3d}
      <div class="mode-switch">
        <button class="mode" class:active={mode === '2d'} onclick={() => (mode = '2d')}>2D</button>
        <button class="mode" class:active={mode === '3d'} onclick={() => (mode = '3d')}>3D</button>
      </div>
    {/if}

    <span class="layer-label">
      {i18n.t('gcodePreview.layer')}
      <bdi class="layer-count" style:min-width="{countWidth}ch">{layer + 1}/{parsed.layerZ.length}</bdi>
      <bdi class="layer-z">
        Z <span class="layer-znum" style:min-width="{zWidth}ch">{layerZ.toFixed(2)}</span> mm
      </bdi>
    </span>

    {#if progressSeg != null}
      <label class="check">
        <input type="checkbox" checked={follow} onchange={(e) => setFollow(e.currentTarget.checked)} />
        {i18n.t('gcodePreview.follow')}
      </label>
    {/if}

    <input
      class="layer-slider"
      type="range"
      min={0}
      max={Math.max(0, parsed.layerZ.length - 1)}
      bind:value={layer}
      oninput={pauseFollow}
      onwheel={(e) => { pauseFollow(); onSliderWheel(e); }}
    />

    <label class="check">
      <input type="checkbox" bind:checked={showPrev} disabled={allow3d && mode === '3d'} />
      {i18n.t('gcodePreview.prevLayer')}
    </label>
    <label class="check">
      <input type="checkbox" bind:checked={showNext} disabled={allow3d && mode === '3d'} />
      {i18n.t('gcodePreview.nextLayer')}
    </label>
    <label class="check"><input type="checkbox" bind:checked={showTravel} /> {i18n.t('gcodePreview.showTravel')}</label>
    <label class="check">
        <input type="checkbox" bind:checked={showBounds} /> {i18n.t('gcodePreview.bounds')}
    </label>
    <label class="check">
      <select class="mode-select" bind:value={colorMode}>
        <option value="extruder">{i18n.t('gcodePreview.byExtruder')}</option>
        <option value="type">{i18n.t('gcodePreview.byType')}</option>
      </select>
    </label>
  </div>

    {#if allow3d && mode === '3d'}
      <ViewerCanvas3D {parsed} {layer} {showTravel} {showBounds} {colorMode} progressSeg={progressSeg} />
    {:else}
      <ViewerCanvas2D
        {parsed} {layer} {showTravel} {colorMode}
        {showPrev} {showNext} {showBounds}
        progressSeg={progressSeg} interactive
      />
    {/if}

  <div class="viewer-footer">
    {i18n.t('gcodePreview.summary', {
      moves: parsed.moveCount,
      layers: parsed.layerZ.length,
      extruders: parsed.extruderCount,
    })}
    {#if noObjectsHint}
      <span class="viewer-note">· {i18n.t('gcodePreview.noObjects')}</span>
    {/if}
  </div>
</div>

<style>
  .viewer { display: flex; flex-direction: column; height: 100%; min-height: 0; gap: var(--space-sm); }
  .viewer-toolbar { display: flex; align-items: center; gap: var(--space-md); flex-wrap: wrap; flex-shrink: 0; }

  .mode-switch { display: flex; border: 1px solid var(--border-color); border-radius: var(--radius-sm); overflow: hidden; }
  .mode { padding: var(--space-xs) var(--space-md); border: none; background: transparent; color: var(--text-secondary); cursor: pointer; font-size: var(--font-size-sm); }
  .mode.active { background: var(--bg-surface-active); color: var(--accent); }
  .mode:disabled { opacity: 0.5; cursor: not-allowed; }

  /* слои растут слева направо независимо от направления интерфейса */
  .layer-slider { flex: 1; min-width: 120px; accent-color: var(--accent); direction: ltr; }
  .layer-label {
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
    white-space: nowrap;
    font-variant-numeric: tabular-nums; /* все цифры одной ширины → ch точен */
  }

  .layer-count {
    display: inline-block;
    text-align: end; /* «/total» стоит на месте, пока текущий слой короче */
  }

  .layer-z {
    color: var(--text-muted);
    margin-inline-start: var(--space-xs);
  }

  .layer-znum {
    display: inline-block;
    text-align: end; /* точка decimal не ездит при росте целой части */
  }
  .check { display: flex; align-items: center; gap: var(--space-xs); font-size: var(--font-size-sm); color: var(--text-secondary); white-space: nowrap; }

  .viewer-footer { font-size: var(--font-size-sm); color: var(--text-muted); flex-shrink: 0; }
  .mode-select { background: var(--bg-surface); color: var(--text-primary); border: 1px solid var(--border-color); border-radius: var(--radius-sm); font-size: var(--font-size-sm); padding: 2px var(--space-xs); }
  .viewer-note { color: var(--warning); }
</style>