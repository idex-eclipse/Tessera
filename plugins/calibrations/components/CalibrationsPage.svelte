<script lang="ts">
  import { usePluginApi } from '../../../plugin-sdk/src/svelte/index';
  import { useCalibrations } from '../use-calibrations.svelte.ts';
  import { subscribeCalibrationsGcodeStore } from '../use-gcode-store.svelte.ts';
  import { shaper, refreshGallery, releasePreview, resetShaperState } from '../shaper-state.svelte.ts';
  import { RE_FITTED, RE_RECOMMENDED, RE_PID, RE_HEATER_PARAM, RE_PID_START, 
    RE_SHAPER_CALIBRATE_START, RE_TARGET_PARAM, RE_TEST_RESONANCES_START, RE_AXIS_PARAM,
    normalizeConsoleLines } from '../parse.ts';
  import KlipperNotReady from '../../shared/klippy-state/KlippyNotReady.svelte';
  import { useKlippyState } from '../../shared/klippy-state/use-klippy-state.svelte.ts';
  import HeaderHelp from '../../shared/header-help/HeaderHelp.svelte';

  import ShaperContent from './panels/Shaper/ShaperContent.svelte';
  import ProbeContent from './panels/Probe/ProbeContent.svelte';
  import HeatersContent from './panels/Heaters/HeatersContent.svelte';
  import MeshContent from './panels/Mesh/MeshContent.svelte';
  import ShaperHelp from './panels/Shaper/ShaperPanelHelp.svelte';
  import BeltsHelp from './panels/BeltsCompare/BeltsHelp.svelte';
  import ProbeHelp from './panels/Probe/ProbePanelHelp.svelte';
  import HeatersHelp from './panels/Heaters/HeatersPanelHelp.svelte';
  import MeshHelp from './panels/Mesh/MeshPanelHelp.svelte';

  import { heaters, resetHeatersState } from '../heaters-state.svelte.ts';

  let { params = {} }: { params?: Record<string, string> } = $props();

  const api = usePluginApi();
  const i18n = api.i18n;
  const store = useCalibrations(api);
  const klippy = useKlippyState(api);

  type Tab = 'mesh' |'probe' | 'shaper' |  'heaters' ;
  let tab = $state<Tab>('mesh');

  // Seed галереи на уровне страницы: гейт shaper-таба зависит от png.
  // Инвалидация по filelist-событиям, подписка на консоль и сброс state на смену принтера.
  $effect(() => {
    void refreshGallery(api);

    const offList = api.moonraker().onNotify('notify_filelist_changed', () => {
      void refreshGallery(api);
    });

    // Shaper/Belts: session-log и live-чипы Fitted/Recommended во время наших прогонов.
    // PID и внешний детект активности — в use-gcode-store (поллинг server.gcode_store).
    const offConsole = api.moonraker().onNotify('notify_gcode_response', (params) => {
      if (shaper.busy === '') return;

      for (const raw of normalizeConsoleLines(params)) {
        const line = raw.trim();
        if (!line) continue;

        if (shaper.busy.startsWith('belts')) {
          shaper.beltLog = [...shaper.beltLog.slice(-99), line];
          continue;
        }

        shaper.sessionLog = [...shaper.sessionLog.slice(-199), line];
        const f = RE_FITTED.exec(line);
        if (f) {
          shaper.fitted = [...shaper.fitted, {
            name: f[1]!, freq: +f[2]!, vib: +f[3]!, smooth: +f[4]!,
          }];
          continue;
        }
        const r = RE_RECOMMENDED.exec(line);
        if (r) shaper.recommended = { name: r[1]!, freq: +r[2]! };
      }
    });

    const offStore = subscribeCalibrationsGcodeStore(api);

    const offPrinter = api.onPrinterChange(() => {
      resetShaperState();
      resetHeatersState();
      void refreshGallery(api);
    });

    return () => {
      offList();
      offConsole();
      offStore();
      offPrinter();
      releasePreview();
    };
  });

  let galleryNotEmpty = $derived(Object.keys(shaper.gallery).length > 0);
  // Гейт: команды ИЛИ уже сгенерированные графики (png в config-руте/shapers)
  let shaperAvailable = $derived(store.state.hasInputShaper || galleryNotEmpty);
  let probeAvailable = $derived(
    store.state.hasProbe || store.state.hasEddy || store.state.hasBltouch ||
      store.state.probeSectionName !== null,
  );
  let heatersAvailable = $derived(store.state.heaters.length > 0);
  let meshAvailable = $derived(store.state.hasBedMesh);

  let tabs = $derived.by(() =>
    [
      { id: 'mesh' as Tab, label: i18n.t('calibrations.section.mesh'), show: meshAvailable },
      { id: 'probe' as Tab, label: i18n.t('calibrations.section.probe'), show: probeAvailable },
      { id: 'heaters' as Tab, label: i18n.t('calibrations.section.heaters'), show: heatersAvailable },
      { id: 'shaper' as Tab, label: i18n.t('calibrations.section.shaper'), show: shaperAvailable },
    ].filter((t) => t.show),
  );

  // deep-link ?section=…; belts уводит в shaper-таб
  $effect(() => {
    const s = params.section;
    if (!s) return;
    const mapped: Tab = s === 'belts' ? 'shaper' : (s as Tab);
    if (tabs.some((t) => t.id === mapped)) tab = mapped;
  });

  $effect(() => {
    if (!tabs.some((t) => t.id === tab)) tab = tabs[0]?.id ?? 'shaper';
  });

  let helpTitle = $derived.by(() => {
    if (tab === 'probe') return i18n.t('calibrations.section.probe');
    if (tab === 'heaters') return i18n.t('calibrations.section.heaters');
    if (tab === 'mesh') return i18n.t('calibrations.section.mesh');
    return i18n.t('calibrations.section.shaper');
  });
</script>

{#if !klippy.ready}
  <div class="card gate"><KlipperNotReady /></div>
{:else if tabs.length === 0}
  <div class="card"><p class="empty">{i18n.t('calibrations.empty')}</p></div>
{:else}
  <div class="card">
    <div class="tabrow">
      <div class="tabs" role="tablist">
        {#each tabs as t (t.id)}
          <button
            class="tab"
            class:active={tab === t.id}
            role="tab"
            aria-selected={tab === t.id}
            onclick={() => (tab = t.id)}
          >
            {t.label}
          </button>
        {/each}
      </div>
      <HeaderHelp title={helpTitle}>
        {#if tab === 'shaper'}
          <ShaperHelp />
          {#if shaper.beltsEnabled}<BeltsHelp />{/if}
        {:else if tab === 'probe'}<ProbeHelp />
        {:else if tab === 'heaters'}<HeatersHelp />
        {:else}<MeshHelp />
        {/if}
      </HeaderHelp>
    </div>

    <div class="body">
      {#if tab === 'shaper'}
        <ShaperContent />
        {#if shaper.previewUrl}
          <img class="preview" src={shaper.previewUrl} alt={shaper.selected ?? ''} />
        {/if}
      {:else if tab === 'probe'}
        <ProbeContent />
      {:else if tab === 'heaters'}
        <HeatersContent />
      {:else}
        <MeshContent />
      {/if}
    </div>
  </div>
{/if}

<style>
  .card {
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-sm);
    overflow: hidden;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  .card.gate { align-items: center; justify-content: center; padding: var(--space-xl); }
  .tabrow {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
    padding: var(--space-xs) var(--space-sm) 0;
    border-bottom: 1px solid var(--border-color);
    flex-shrink: 0;
  }
  .tabs { display: flex; gap: 2px; flex: 1; min-width: 0; overflow-x: auto; }
  .tab {
    padding: var(--space-xs) var(--space-md);
    border: none;
    background: transparent;
    color: var(--text-secondary);
    font-size: var(--font-size-sm);
    border-radius: var(--radius-sm) var(--radius-sm) 0 0;
    cursor: pointer;
    white-space: nowrap;
  }
  .tab:hover { background: var(--bg-surface-hover); }
  .tab.active { background: var(--bg-surface-active); color: var(--accent); font-weight: 600; }
  .body {
    padding: var(--space-md);
    display: flex;
    flex-direction: column;
    gap: var(--space-md);
    min-height: 0;
  }
  .sep { border-top: 1px dashed var(--border-color); }
  .preview {
    max-width: 100%;
    max-height: 420px;
    object-fit: contain;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    background: var(--bg-surface-hover);
  }
  .empty { color: var(--text-muted); text-align: center; padding: var(--space-lg); margin: 0; }
  :global(mpu-calibrations-page) { display: flex; flex-direction: column; width: 100%; min-height: 100%; }
</style>