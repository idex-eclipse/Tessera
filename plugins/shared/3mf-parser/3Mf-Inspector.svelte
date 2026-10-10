<script lang="ts">
  // Презентационный оверлей 3MF-инспектора (shared: без своего бандла локалей,
  // без запросов, без состояния между плагинами). Строки — через t потребителя
  // (ключи tmf.* дублируются в system и jobs). Запросы и freeze-семантику
  // управляет плагин-потребитель через колбэки и флаги busy/canPrint.
  import type { ThreeMFHandle, ThreeMFPlate, ThreeMFWarningCode } from './types';
  import { prettifyObjectName } from './parser';

  let {
    open = false,
    handle = null,
    busy = false,          // локальный freeze операции у потребителя
    canPrint = false,      // потребитель: printer.info state === standby && connected
    printHint = '',        // подсказка, почему печать недоступна (title кнопки)
    t,
    onClose,
    onUpload,
    onUploadAndPrint,
  }: {
    open: boolean;
    handle: ThreeMFHandle | null;
    busy?: boolean;
    canPrint?: boolean;
    printHint?: string;
    t: (key: string, params?: Record<string, string | number>) => string;
    onClose: () => void;
    onUpload: (plateId: number) => void;
    onUploadAndPrint: (plateId: number) => void;
  } = $props();

  let thumbs = $state<Record<number, string>>({});

  const requestClose = () => {
    if (!busy) onClose();   // во время freeze закрытие заблокировано
  };

  // Превью тянем лениво и только пока оверлей открыт; object URL гасим
  // ровно один раз в cleanup эффекта (close/unmount), без двойного revoke.
  $effect(() => {
    if (!open || !handle) return;
    const urls: string[] = [];
    let alive = true;
    for (const plate of handle.inspection.plates) {
      if (!plate.thumbnailPath) continue;
      handle
        .plateThumbnail(plate.id)
        .then((blob) => {
          if (!alive || !blob) return;
          const url = URL.createObjectURL(blob);
          urls.push(url);
          thumbs = { ...thumbs, [plate.id]: url };
        })
        .catch(() => {});
    }
    return () => {
      alive = false;
      for (const u of urls) URL.revokeObjectURL(u);
      urls.length = 0;
      thumbs = {};
    };
  });

  $effect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') requestClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const WARN_KEY: Record<ThreeMFWarningCode, string> = {
    'no-plates': 'tmf.warn.noPlates',
    'no-gcode': 'tmf.warn.noGcode',
    'plate-gcode-missing': 'tmf.warn.plateGcodeMissing',
    'unknown-vendor': 'tmf.warn.unknownVendor',
    'model-settings-missing': 'tmf.warn.modelSettingsMissing',
    'project-settings-broken': 'tmf.warn.projectSettingsBroken',
    'plate-json-broken': 'tmf.warn.plateJsonBroken',
  };

  const fmtMb = (n: number) => t('tmf.unit.mb', { n: (n / 1048576).toFixed(1) });
  const fmtSize = (n?: number) =>
    n == null ? '' : n >= 1048576 ? fmtMb(n) : t('tmf.unit.kb', { n: Math.max(1, Math.round(n / 1024)) });
  const fmtDuration = (sec?: number) => {
    if (sec == null || !Number.isFinite(sec)) return '';
    const m = Math.round(sec / 60);
    if (m < 1) return t('tmf.unit.sec', { n: Math.round(sec) });
    if (m < 60) return t('tmf.unit.min', { n: m });
    return t('tmf.unit.hmin', { h: Math.floor(m / 60), m: m % 60 });
  };

  const plateFilaments = (p: ThreeMFPlate) => {
    if (p.slice?.filaments?.length) {
      return p.slice.filaments.map((f) => ({
        color: f.color,
        label: f.type ?? `#${f.id}`,
        used: f.usedG != null ? t('tmf.unit.g', { n: f.usedG.toFixed(1) }) : '',
      }));
    }
    return p.filamentSlots
      .map((slot) => handle?.inspection.filamentSlots.find((s) => s.slot === slot))
      .filter((s) => !!s)
      .map((s) => ({ color: s!.color, label: s!.type ?? `#${s!.slot}`, used: '' }));
  };
</script>

{#if open && handle}
  {@const ins = handle.inspection}
  <div class="dialog-backdrop" onclick={requestClose} role="presentation"></div>
  <div class="dialog" role="dialog" aria-modal="true" aria-label={t('tmf.title')}>
    <div class="dialog-header">
      <h3>{t('tmf.title')}</h3>
      <div class="header-side">
        {#if ins.slicerVersion}
          <span class="badge">{ins.vendor === 'unknown' ? t('tmf.vendor.unknown') : ins.vendor} {ins.slicerVersion}</span>
        {/if}
        <button class="icon-btn" onclick={requestClose} aria-label={t('tmf.close')}>×</button>
      </div>
    </div>

    <div class="dialog-body">
      {#if ins.printer?.model || ins.printer?.processProfile}
        <p class="sub">
          {[ins.printer?.model, ins.printer?.processProfile].filter(Boolean).join(' · ')}
          {#if ins.layerHeight != null}· {ins.layerHeight} mm{/if}
        </p>
      {/if}

      {#each ins.warnings as w (w.code + ':' + (w.plateId ?? 0))}
        <p class="notice" class:error={w.code === 'no-gcode'}>
          {t(WARN_KEY[w.code], { plate: w.plateId ?? '' })}
        </p>
      {/each}

      {#each ins.plates as p (p.id)}
        <article class="plate">
          <div class="thumb">
            {#if thumbs[p.id]}
              <img src={thumbs[p.id]} alt="" />
            {:else}
              <div class="thumb-empty" aria-hidden="true"></div>
            {/if}
          </div>

          <div class="info">
            <div class="plate-name">
              {p.name}
              {#if p.slice?.predictionSec != null}
                <span class="meta">· {fmtDuration(p.slice.predictionSec)}</span>
              {/if}
              {#if p.gcodeSize != null}
                <span class="meta">· {fmtSize(p.gcodeSize)}</span>
              {/if}
            </div>

            {#if p.slice?.weightG != null || p.slice?.firstLayerSec != null || p.info?.bedType}
              <div class="meta-row">
                {#if p.slice?.weightG != null}<span>{t('tmf.unit.g', { n: p.slice.weightG.toFixed(1) })}</span>{/if}
                {#if p.slice?.firstLayerSec != null}<span>{t('tmf.firstLayer')}: {fmtDuration(p.slice.firstLayerSec)}</span>{/if}
                {#if p.info?.bedType}<span>{p.info.bedType}</span>{/if}
              </div>
            {/if}

            {#if p.objects.length}
              <div class="meta-row objects" title={p.objects.map((o) => o.name).join(', ')}>
                {#each p.objects as o (o.name + ':' + (o.identifyId ?? 0))}
                  <span class="chip" class:skipped={o.skipped}>{prettifyObjectName(o.name)}</span>
                {/each}
              </div>
            {/if}

            {#if plateFilaments(p).length}
              <div class="meta-row">
                {#each plateFilaments(p) as f (f.label + ':' + (f.used ?? ''))}
                  <span class="chip filament">
                    <i class="dot" style:background={f.color ?? 'var(--text-secondary)'}></i>
                    {f.label}{#if f.used} · {f.used}{/if}
                  </span>
                {/each}
              </div>
            {/if}
          </div>

          <div class="actions">
            <button
              class="btn btn-secondary"
              disabled={busy || !p.gcodePath}
              onclick={() => onUpload(p.id)}
            >
              {t('tmf.upload')}
            </button>
            <button
              class="btn"
              disabled={busy || !canPrint || !p.gcodePath}
              title={canPrint ? '' : printHint}
              onclick={() => onUploadAndPrint(p.id)}
            >
              {t('tmf.uploadPrint')}
            </button>
          </div>
        </article>
      {/each}
    </div>
  </div>
{/if}

<style>
  .dialog-backdrop { position: fixed; inset: 0; background: var(--bg-overlay); z-index: 300; }
  .dialog {
    position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
    width: 90%; max-width: 560px; max-height: 82vh; display: flex; flex-direction: column;
    background: var(--bg-surface); border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg); z-index: 301; overflow: hidden;
  }
  .dialog-header {
    display: flex; align-items: center; justify-content: space-between; gap: var(--space-md);
    padding: var(--space-md) var(--space-lg); border-bottom: 1px solid var(--border-color);
  }
  .dialog-header h3 { font-size: var(--font-size-lg); font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .header-side { display: flex; align-items: center; gap: var(--space-sm); flex-shrink: 0; }
  .badge {
    padding: 2px var(--space-sm); border: 1px solid var(--border-color);
    border-radius: var(--radius-md); font-size: var(--font-size-sm); color: var(--text-secondary);
  }
  .icon-btn {
    border: none; background: transparent; color: var(--text-secondary);
    font-size: var(--font-size-lg); line-height: 1; cursor: pointer;
    padding: var(--space-xs); border-radius: var(--radius-md);
  }
  .icon-btn:hover { background: var(--bg-surface-hover); color: var(--text-primary); }
  .dialog-body { padding: var(--space-lg); overflow-y: auto; display: flex; flex-direction: column; gap: var(--space-md); }
  .sub { color: var(--text-secondary); font-size: var(--font-size-sm); }
  .notice {
    padding: var(--space-sm) var(--space-md); border-radius: var(--radius-md);
    background: var(--bg-surface-hover); color: var(--text-secondary); font-size: var(--font-size-sm);
  }
  .notice.error { color: var(--danger); }
  .plate {
    display: grid; grid-template-columns: 96px 1fr auto; gap: var(--space-md);
    align-items: start; padding: var(--space-md);
    border: 1px solid var(--border-color); border-radius: var(--radius-md);
  }
  .thumb, .thumb-empty { width: 96px; height: 96px; border-radius: var(--radius-md); overflow: hidden; }
  .thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .thumb-empty { background: var(--bg-surface-hover); }
  .info { min-width: 0; display: flex; flex-direction: column; gap: var(--space-xs); }
  .plate-name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .meta { color: var(--text-secondary); font-weight: 400; font-size: var(--font-size-sm); }
  .meta-row { display: flex; flex-wrap: wrap; gap: var(--space-xs); color: var(--text-secondary); font-size: var(--font-size-sm); }
  .chip {
    display: inline-flex; align-items: center; gap: 4px;
    padding: 1px var(--space-sm); border: 1px solid var(--border-color);
    border-radius: var(--radius-md); font-size: var(--font-size-sm);
    max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .chip.skipped { text-decoration: line-through; opacity: 0.6; }
  .dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
  .actions { display: flex; flex-direction: column; gap: var(--space-sm); flex-shrink: 0; }
  .btn { padding: var(--space-sm) var(--space-lg); border: none; border-radius: var(--radius-md); font-size: var(--font-size-md); cursor: pointer; }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-secondary { background: var(--bg-surface-hover); color: var(--text-primary); }
</style>