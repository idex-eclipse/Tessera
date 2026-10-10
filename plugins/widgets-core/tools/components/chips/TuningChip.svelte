<script lang="ts">
  import { usePluginApi } from '../../../../../plugin-sdk/src/svelte/index';
  import { useToolhead } from '../../use-toolhead.svelte';
  import { useKlippyState } from '../../../../shared/klippy-state/use-klippy-state.svelte';
  import KlippyNotReadyChip from '../../../../shared/klippy-state/KlippyNotReady.svelte';
  import SliderField from '../../../../shared/slider-field/SliderField.svelte';
  import Icon from '../../../../shared/icons/Icon.svelte';

  type Subject = 'pressure_advance' | 'retraction' | 'flow' | 'speed';

  let { params = {} }: { params?: Record<string, string> } = $props();

  const api = usePluginApi();
  const i18n = api.i18n;
  const tools = useToolhead(api);
  const klippy = useKlippyState(api);

  let subject = $derived((params.chipId ?? '') as Subject);
  let editMode = $derived(params.edit === '1');
  let customLabel = $derived(params.chipLabel);

  const FLOW_PRESETS = [90, 95, 100, 105, 110];
  const SPEED_PRESETS = [50, 75, 100, 150, 200];
  const FLOW_MIN = 1;
  const FLOW_MAX = 200;

  let draftPA = $state({ advance: '0.000', smooth: '0.040' });
  let focusedPA = $state(false);
  let pendingPA = $state<{ advance: number; smooth: number } | null>(null);
  let dirtyPA = $state(false);

  $effect(() => {
    if (subject !== 'pressure_advance') return;
    if (focusedPA || dirtyPA) return;
    const e = tools.th.activeExtruder;
    const cur = tools.th.pa[e] ?? tools.meta.defaults.pa[e] ?? { advance: 0, smooth: 0.04 };
    if (pendingPA) {
      if (
        Math.abs(cur.advance - pendingPA.advance) < 1e-4 &&
        Math.abs(cur.smooth - pendingPA.smooth) < 1e-4
      ) {
        pendingPA = null;
      } else {
        return;
      }
    }
    draftPA = { advance: cur.advance.toFixed(3), smooth: cur.smooth.toFixed(3) };
  });

  function onInputPA(field: 'advance' | 'smooth', value: string): void {
    draftPA = { ...draftPA, [field]: value };
    dirtyPA = true;
  }

  let previewPA = $derived.by(() => {
    const a = Number(draftPA.advance);
    const s = Number(draftPA.smooth);
    if (!Number.isFinite(a) || !Number.isFinite(s)) return '';
    return `SET_PRESSURE_ADVANCE EXTRUDER=${tools.th.activeExtruder} ADVANCE=${a.toFixed(3)} SMOOTH_TIME=${s.toFixed(3)}`;
  });

  function applyPA(): void {
    const a = Number(draftPA.advance);
    const s = Number(draftPA.smooth);
    if (!Number.isFinite(a) || !Number.isFinite(s)) return;
    pendingPA = { advance: a, smooth: s };
    dirtyPA = false;
    tools.setPA({ advance: a, smooth: s });
    popoverOpen = false;
    setTimeout(() => {
      if (pendingPA && pendingPA.advance === a && pendingPA.smooth === s) {
        pendingPA = null;
      }
    }, 3000);
  }

  function resetPA(): void {
    const e = tools.th.activeExtruder;
    const d = tools.meta.defaults.pa[e] ?? { advance: 0, smooth: 0.04 };
    draftPA = { advance: d.advance.toFixed(3), smooth: d.smooth.toFixed(3) };
    dirtyPA = false;
  }

  // --- Retraction: 4 draft-поля ---
  let draftR = $state({ length: '', speed: '', extra: '', unspeed: '' });
  let focusedR = $state(false);
  let pendingR = $state<{ length?: number; speed?: number; extra?: number; unspeed?: number } | null>(null);
  let dirtyR = $state(false);

  $effect(() => {
    if (subject !== 'retraction') return;
    if (focusedR || dirtyR) return;
    const cur = tools.th.retraction;
    if (pendingR) {
      const match =
        (pendingR.length == null || Math.abs(cur.length - pendingR.length) < 1e-3) &&
        (pendingR.speed == null || Math.abs(cur.speed - pendingR.speed) < 1e-3) &&
        (pendingR.extra == null || Math.abs(cur.extra - pendingR.extra) < 1e-3) &&
        (pendingR.unspeed == null || Math.abs(cur.unspeed - pendingR.unspeed) < 1e-3);
      if (match) pendingR = null;
      else return;
    }
    draftR = {
      length: cur.length.toFixed(2),
      speed: cur.speed.toFixed(0),
      extra: cur.extra.toFixed(2),
      unspeed: cur.unspeed.toFixed(0),
    };
  });

  function onInputR(field: 'length' | 'speed' | 'extra' | 'unspeed', value: string): void {
    draftR = { ...draftR, [field]: value };
    dirtyR = true;
  }

  let previewR = $derived.by(() => {
    const parts: string[] = ['SET_RETRACTION'];
    const l = Number(draftR.length);
    const s = Number(draftR.speed);
    const x = Number(draftR.extra);
    const u = Number(draftR.unspeed);
    if (draftR.length !== '' && Number.isFinite(l)) parts.push(`RETRACT_LENGTH=${l.toFixed(2)}`);
    if (draftR.speed !== '' && Number.isFinite(s)) parts.push(`RETRACT_SPEED=${s.toFixed(0)}`);
    if (draftR.extra !== '' && Number.isFinite(x)) parts.push(`UNRETRACT_EXTRA_LENGTH=${x.toFixed(2)}`);
    if (draftR.unspeed !== '' && Number.isFinite(u)) parts.push(`UNRETRACT_SPEED=${u.toFixed(0)}`);
    return parts.join(' ');
  });

  function applyR(): void {
    const patch: { length?: number; speed?: number; extra?: number; unspeed?: number } = {};
    const l = Number(draftR.length); if (draftR.length !== '' && Number.isFinite(l)) patch.length = l;
    const s = Number(draftR.speed); if (draftR.speed !== '' && Number.isFinite(s)) patch.speed = s;
    const x = Number(draftR.extra); if (draftR.extra !== '' && Number.isFinite(x)) patch.extra = x;
    const u = Number(draftR.unspeed); if (draftR.unspeed !== '' && Number.isFinite(u)) patch.unspeed = u;
    if (Object.keys(patch).length === 0) return;
    pendingR = patch;
    dirtyR = false;
    tools.setRetraction(patch);
    popoverOpen = false;
    setTimeout(() => {
      if (pendingR === patch) pendingR = null;
    }, 3000);
  }

  function resetR(): void {
    const d = tools.meta.defaults.retraction;
    draftR = {
      length: d.length.toFixed(2),
      speed: d.speed.toFixed(0),
      extra: d.extra.toFixed(2),
      unspeed: d.unspeed.toFixed(0),
    };
    dirtyR = false;
  }

  //Sync
  function openPopover(): void {
    if (disabled) return;
    const rect = chipEl?.getBoundingClientRect();
    if (rect) {
      placement = { above: rect.top > 220, alignRight: rect.left + 260 > window.innerWidth };
    }
    popoverOpen = true;
    if (subject === 'pressure_advance') {
      const e = tools.th.activeExtruder;
      const cur = tools.th.pa[e] ?? tools.meta.defaults.pa[e] ?? { advance: 0, smooth: 0.04 };
      draftPA = { advance: cur.advance.toFixed(3), smooth: cur.smooth.toFixed(3) };
      dirtyPA = false;
      pendingPA = null;
    } else if (subject === 'retraction') {
      const cur = tools.th.retraction;
      draftR = {
        length: cur.length.toFixed(2),
        speed: cur.speed.toFixed(0),
        extra: cur.extra.toFixed(2),
        unspeed: cur.unspeed.toFixed(0),
      };
      dirtyR = false;
      pendingR = null;
    }
  }

  // --- Flow / Speed ---
  let pctOf = (factor: number) => Math.round(factor * 100);
  let flowPct = $derived(pctOf(tools.th.extrudeFactor));
  let speedPct = $derived(pctOf(tools.th.speedFactor));

  function setFlow(pct: number): void {
    tools.setFlow(pct);
    popoverOpen = false;
  }
  function setSpeed(pct: number): void {
    tools.setSpeed(pct);
    popoverOpen = false;
  }
  function resetFlow(): void { tools.setFlow(100); }
  function resetSpeed(): void { tools.setSpeed(100); }

  //popover
  let chipEl = $state<HTMLDivElement | null>(null);
  let popoverOpen = $state(false);
  let placement = $state<{ above: boolean; alignRight: boolean }>({ above: true, alignRight: false });

  let label = $derived.by(() => {
    if (customLabel) return customLabel;
    switch (subject) {
      case 'pressure_advance': return i18n.t('widgets.tools.paChip');
      case 'retraction': return i18n.t('widgets.tools.retractionChip');
      case 'flow': return i18n.t('widgets.tools.flow');
      case 'speed': return i18n.t('widgets.tools.speed');
      default: return subject;
    }
  });

  let displayValue = $derived.by<string>(() => {
    switch (subject) {
      case 'pressure_advance': {
        const e = tools.th.activeExtruder;
        const cur = tools.th.pa[e] ?? tools.meta.defaults.pa[e];
        return cur ? cur.advance.toFixed(3) : '—';
      }
      case 'retraction': return `${tools.th.retraction.length.toFixed(2)} mm`;
      case 'flow': return `${flowPct}%`;
      case 'speed': return `${speedPct}%`;
      default: return '—';
    }
  });

  let subLabel = $derived.by<string>(() =>
    subject === 'pressure_advance' ? tools.th.activeExtruder : '',
  );

  let missing = $derived(
    klippy.state === 'ready' && (subject === 'retraction' && !tools.meta.hasRetraction),
  );
  let disabled = $derived(editMode || missing || !subject);

  function closePopover(): void { popoverOpen = false; }
</script>

<div class="chip-root">
  <div
    class="chip"
    class:missing
    class:interactive={!disabled}
    bind:this={chipEl}
    onclick={openPopover}
    role="button"
    tabindex={disabled ? -1 : 0}
    onkeydown={(e) => { if (e.key === 'Enter' && !disabled) openPopover(); }}
  >
    {#if klippy.state !== 'ready'}
      <KlippyNotReadyChip />
    {:else}
      <span class="stripe"></span>
      <span class="body">
        <span class="top">
          <span class="label" title={label}>{label}</span>
          {#if subLabel}<span class="sub">{subLabel}</span>{/if}
        </span>
        <span class="bottom">
          <span class="kind" class:active={popoverOpen}><Icon name="kind-tuning" size={40} /></span>
          <span class="value">{displayValue}</span>
        </span>
      </span>
    {/if}
  </div>

  {#if popoverOpen && subject && !missing}
    <div class="chip-popover-backdrop" onclick={closePopover} role="presentation"></div>
    <div class="chip-popover" class:below={!placement.above} class:align-right={placement.alignRight}>
      <div class="pop-title">{label}</div>

      {#if subject === 'pressure_advance'}
        <div class="field">
          <span class="field-label">{i18n.t('widgets.tools.tuning.advance')}</span>
          <input
            class="field-input"
            type="number"
            min="0" max="0.2" step="0.001"
            value={draftPA.advance}
            onfocus={() => (focusedPA = true)}
            onblur={() => (focusedPA = false)}
            oninput={(e) => onInputPA('advance', e.currentTarget.value)}
          />
        </div>
        <div class="field">
          <span class="field-label">{i18n.t('widgets.tools.paSmooth')}</span>
          <input
            class="field-input"
            type="number"
            min="0" max="0.2" step="0.001"
            value={draftPA.smooth}
            onfocus={() => (focusedPA = true)}
            onblur={() => (focusedPA = false)}
            oninput={(e) => onInputPA('smooth', e.currentTarget.value)}
          />
        </div>
        <code class="preview" title={previewPA}>{previewPA}</code>
        <div class="pop-actions">
          <button class="pop-btn" onclick={resetPA}>{i18n.t('widgets.tools.tuning.reset')}</button>
          <button class="pop-btn primary" onclick={applyPA}>{i18n.t('widgets.tools.tuning.apply')}</button>
        </div>

      {:else if subject === 'retraction'}
        <div class="field">
          <span class="field-label">{i18n.t('widgets.tools.retractLength')}</span>
          <input class="field-input" type="number" min="0" step="0.01" value={draftR.length}
                 onfocus={() => (focusedR = true)} onblur={() => (focusedR = false)}
                 oninput={(e) => onInputR('length', e.currentTarget.value)} />
        </div>
        <div class="field">
          <span class="field-label">{i18n.t('widgets.tools.retractSpeed')}</span>
          <input class="field-input" type="number" min="0" step="1" value={draftR.speed}
                 onfocus={() => (focusedR = true)} onblur={() => (focusedR = false)}
                 oninput={(e) => onInputR('speed', e.currentTarget.value)} />
        </div>
        <div class="field">
          <span class="field-label">{i18n.t('widgets.tools.unretractExtra')}</span>
          <input class="field-input" type="number" step="0.01" value={draftR.extra}
                 onfocus={() => (focusedR = true)} onblur={() => (focusedR = false)}
                 oninput={(e) => onInputR('extra', e.currentTarget.value)} />
        </div>
        <div class="field">
          <span class="field-label">{i18n.t('widgets.tools.unretractSpeed')}</span>
          <input class="field-input" type="number" min="0" step="1" value={draftR.unspeed}
                 onfocus={() => (focusedR = true)} onblur={() => (focusedR = false)}
                 oninput={(e) => onInputR('unspeed', e.currentTarget.value)} />
        </div>
        <code class="preview" title={previewR}>{previewR}</code>
        <div class="pop-actions">
          <button class="pop-btn" onclick={resetR}>{i18n.t('widgets.tools.tuning.reset')}</button>
          <button class="pop-btn primary" onclick={applyR}>{i18n.t('widgets.tools.tuning.apply')}</button>
        </div>

      {:else if subject === 'speed'}
        {@const pct = speedPct}
        {@const set = setSpeed}
        {@const reset = resetSpeed}
        <div class="preset-row">
          {#each SPEED_PRESETS as p (p)}
            <button
              class="preset-btn"
              class:active={Math.abs(pct - p) < 1}
              onclick={() => set(p)}
            >{p}%</button>
          {/each}
        </div>
        <SliderField
          label={label}
          value={pct}
          min={FLOW_MIN}
          max={FLOW_MAX}
          step={1}
          unit="%"
          onCommit={set}
          onReset={reset}
        />
      {:else if subject === 'flow'}
        {@const pct = flowPct}
        {@const set = setFlow}
        {@const reset = resetFlow}
        <div class="preset-row">
          {#each FLOW_PRESETS as p (p)}
            <button
              class="preset-btn"
              class:active={Math.abs(pct - p) < 1}
              onclick={() => set(p)}
            >{p}%</button>
          {/each}
        </div>
        <SliderField
          label={label}
          value={pct}
          min={FLOW_MIN}
          max={FLOW_MAX}
          step={1}
          unit="%"
          onCommit={set}
          onReset={reset}
        />
      {/if}
    </div>
  {/if}
</div>

<style>
  .chip-root { 
    position: relative; 
    height: 100%; 
  }

  .chip {
    position: relative;
    display: flex;
    height: 100%;
    min-width: 104px;
    max-width: 220px;
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
    background: var(--accent);
  }

  .body {
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    gap: 2px;
    min-width: 0;
    flex: 1;
  }

  .top {
    display: flex;
    align-items: baseline;
    gap: 6px;
    min-width: 0;
    font-weight: 600;
  }

  .label {
    font-size: var(--font-size-lg);
    color: var(--accent);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
    min-width: 0;
  }

  .sub {
    font-family: ui-monospace, monospace;
    font-size: var(--font-size-sm);
    color: var(--text-muted);
    flex-shrink: 0;
  }

  .bottom {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .kind {
    display: flex;
    line-height: 0;
    color: var(--text-muted);
    opacity: 0.55;
    flex-shrink: 0;
  }
  .kind.active {
    color: var(--accent);
  }

  .value {
    margin-left: auto;
    flex-shrink: 0;
    font-family: ui-monospace, monospace;
    font-size: var(--font-size-lg);
    font-weight: 700;
    color: var(--text-primary);
    font-variant-numeric: tabular-nums;
    line-height: 1;
  }

  .chip.interactive { cursor: pointer; }
  .chip.interactive:hover {
    box-shadow: var(--shadow-sm);
    border-color: color-mix(in srgb, var(--accent) 45%, var(--border-color));
  }
  .chip.interactive:active { transform: translateY(1px); }
  .chip.missing { border-style: dashed; }

  .chip.missing .label, .chip.missing .value {
    color: var(--text-muted);
  }

  .chip-popover-backdrop {
    position: fixed;
    inset: 0;
    z-index: 1000;
  }

  .chip-popover {
    position: absolute;
    bottom: calc(100% + 6px);
    left: 0;
    z-index: 1001;
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-md);
    padding: var(--space-sm);
    min-width: 240px;
    max-width: 300px;
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
  }

  .chip-popover.below {
    bottom: auto;
    top: calc(100% + 6px);
  }

  .chip-popover.align-right {
    left: auto;
    right: 0;
  }

  .pop-title {
    font-size: var(--font-size-sm);
    font-weight: 600;
    color: var(--text-primary);
    padding: 0 var(--space-xs);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .field-label {
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
  }

  .field-input {
    padding: var(--space-xs) var(--space-sm);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    background: var(--bg-surface);
    color: var(--text-primary);
    font-family: ui-monospace, monospace;
    font-size: var(--font-size-sm);
  }
  
  .field-input:focus {
    outline: none;
    border-color: var(--accent);
  }

  .preview {
    display: block;
    padding: var(--space-xs);
    background: var(--bg-surface-hover-no-override);
    border-radius: var(--radius-sm);
    font-family: ui-monospace, monospace;
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
    white-space: pre-wrap;
    word-break: break-word;
    border: 1px solid var(--border-color);
  }

  .pop-actions {
    display: flex;
    gap: var(--space-xs);
  }
  .pop-btn {
    flex: 1;
    padding: var(--space-xs) var(--space-sm);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    background: var(--bg-surface-hover);
    color: var(--text-primary);
    font-size: var(--font-size-sm);
    cursor: pointer;
  }

  .pop-btn:hover { background: var(--bg-surface-active); }

  .pop-btn.primary {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--accent-text);
  }

  .pop-btn.primary:hover { filter: brightness(1.1); }

  .preset-row {
    display: flex;
    gap: var(--space-xs);
  }

  .preset-btn {
    flex: 1;
    padding: var(--space-xs);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    background: var(--bg-surface-hover-no-override);
    color: var(--text-primary);
    font-size: var(--font-size-sm);
    font-variant-numeric: tabular-nums;
    cursor: pointer;
    transition: 
      background var(--transition-fast), 
      border-color var(--transition-fast), 
      color var(--transition-fast);
  }
  .preset-btn:hover { background: var(--bg-surface-active); }

  .preset-btn.active {
    background: var(--accent-subtle-strong);
    border-color: var(--accent);
    color: var(--accent);
    font-weight: 600;
  }
</style>