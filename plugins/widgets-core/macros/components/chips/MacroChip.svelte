<script lang="ts">
  import { usePluginApi } from '../../../../../plugin-sdk/src/svelte/index';
  import { useMacros } from '../../use-macros.svelte';
  import { useKlippyState } from '../../../../shared/klippy-state/use-klippy-state.svelte';
  import KlippyNotReadyChip from '../../../../shared/klippy-state/KlippyNotReady.svelte';
  import ConfirmDialog from '../../../../shared/confirm-dialog.svelte';
  import MacroParamsMenu from '../MacroParamsMenu.svelte';
  import Icon from '../../../../shared/icons/Icon.svelte';
  import { buildMacroScript } from '../../../../shared/macro-params';

  let { params = {} }: { params?: Record<string, string> } = $props();

  const api = usePluginApi();
  const i18n = api.i18n;
  const macros = useMacros(api);
  const klippy = useKlippyState(api);

  let macroName = $derived(params.chipId ?? '');
  let editMode = $derived(params.edit === '1');
  let customLabel = $derived(params.chipLabel);

  let item = $derived(macros.itemOf(macroName));
  let known = $derived(macros.liveNames.includes(macroName));
  let macroParams = $derived(macros.paramsByMacro[macroName] ?? []);
  let hasParams = $derived(macroParams.length > 0);

  let label = $derived(customLabel || item.alias || macroName);
  let stripeColor = $derived(item.color ?? 'var(--accent)');

  // разбивка имени по `_` и `-` для безопасных переносов через <wbr>
  let nameParts = $derived(label.split(/([_-])/));

  let missing = $derived(klippy.state === 'ready' && !known);

  let printState = $state<string>('idle');
  $effect(() => {
    return api.moonraker().subscribe(
      { print_stats: ['state'] },
      (delta: any) => {
        const s = delta?.print_stats?.state;
        if (typeof s === 'string') printState = s;
      },
    );
  });
  let isPrinting = $derived(printState === 'printing' || printState === 'paused');
  let disabled = $derived(editMode || missing || isPrinting);

  let chipEl = $state<HTMLDivElement | null>(null);
  let popoverOpen = $state(false);
  let placement = $state<{ above: boolean; alignRight: boolean }>({ above: true, alignRight: false });

  let paramsMenuOpen = $state(false);
  let paramsAnchor = $state<{ left: number; top: number; bottom: number } | null>(null);

  function openChip(): void {
    if (disabled) return;
    const rect = chipEl?.getBoundingClientRect();
    if (!rect) return;

    if (hasParams) {
      paramsAnchor = { left: rect.left, top: rect.top, bottom: rect.bottom };
      paramsMenuOpen = true;
    } else {
      placement = { above: rect.top > 180, alignRight: rect.left + 220 > window.innerWidth };
      popoverOpen = true;
    }
  }

  function closePopover(): void { popoverOpen = false; }

  let confirmOpen = $state(false);
  let pendingValues: Record<string, string> | null = null;

  function requestRun(values: Record<string, string>): void {
    if (item.confirm) {
      pendingValues = values;
      confirmOpen = true;
      return;
    }
    doRun(values);
  }

  function doRun(values: Record<string, string> | null): void {
    const v = values ?? pendingValues ?? {};
    const script = hasParams ? buildMacroScript(macroName, macroParams, v) : macroName;
    api
      .moonraker()
      .request('printer.gcode.script', { script })
      .catch((e) => console.error('[macro-chip] run failed:', script, e));
    pendingValues = null;
    confirmOpen = false;
    paramsMenuOpen = false;
    popoverOpen = false;
  }

  function onConfirmRun(): void { doRun(pendingValues); }
</script>

<div class="chip-root">
  <div
    class="chip"
    class:missing
    class:interactive={!disabled}
    bind:this={chipEl}
    onclick={openChip}
    role="button"
    tabindex={disabled ? -1 : 0}
    onkeydown={(e) => {
      if (e.key === 'Enter' && !disabled) openChip();
    }}
  >
    {#if klippy.state !== 'ready'}
      <KlippyNotReadyChip />
    {:else}
      <span class="stripe" style:background={stripeColor}></span>
      <span class="body">
        <span class="top">
          <span class="category">{i18n.t('widgets.macros.chipSection')}</span>
        </span>
        <span class="bottom">
          <span class="kind" class:active={popoverOpen === true || paramsMenuOpen === true}><Icon name="kind-macro" size={40} /></span>
          <span class="name" title={macroName}>
            {#each nameParts as seg, i (i)}
              {seg}{#if i < nameParts.length - 1}<wbr />{/if}
            {/each}
          </span>
        </span>
      </span>
    {/if}
  </div>

  {#if popoverOpen && known && !hasParams}
    <div class="chip-popover-backdrop" onclick={closePopover} role="presentation"></div>
    <div class="chip-popover" class:below={!placement.above} class:align-right={placement.alignRight}>
      <div class="pop-title">{macroName}</div>
      <button class="pop-btn primary" onclick={() => requestRun({})}>
        {i18n.t('widgets.macros.run')}
      </button>
    </div>
  {/if}

  {#if paramsMenuOpen && paramsAnchor}
    <MacroParamsMenu
      name={macroName}
      params={macroParams}
      anchor={paramsAnchor}
      onRun={(values) => {
        paramsMenuOpen = false;
        requestRun(values);
      }}
      onClose={() => { paramsMenuOpen = false; }}
    />
  {/if}
</div>

{#if confirmOpen}
  <ConfirmDialog
    open={confirmOpen}
    title={i18n.t('widgets.macros.confirmTitle')}
    message={i18n.t('widgets.macros.confirmRun', { name: macroName })}
    confirmLabel={i18n.t('widgets.macros.run')}
    danger={false}
    onConfirm={onConfirmRun}
    onClose={() => { confirmOpen = false; pendingValues = null; }}
  />
{/if}

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
    transition:
      background var(--transition-fast),
      border-color var(--transition-fast),
      box-shadow var(--transition-fast);
  }
  .stripe { position: absolute; left: 0; top: 0; bottom: 0; width: 3px; }

  .body {
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    gap: 2px;
    min-width: 0;
    flex: 1;
  }

  /* строка 1: категория */
  .top { display: flex; align-items: baseline; gap: 6px; min-width: 0; font-weight: 600; }
  .category {
    font-size: var(--font-size-lg);
    color: var(--accent);
    white-space: nowrap;
  }

  /* строка 2: иконка + имя */
  .bottom { display: flex; align-items: center; gap: 6px; min-width: 0; }
  .kind { display: flex; line-height: 0; color: var(--text-muted); opacity: 0.55; flex-shrink: 0; }
  .kind.active {
    color: var(--accent)  
  }
  .name {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: var(--font-size-md);
    font-weight: 600;
    color: var(--text-primary);
    line-height: 1.15;
    /* переносы по wbr + word-break на всякий случай */
    word-break: break-word;
  }

  .chip.interactive { cursor: pointer; }
  .chip.interactive:hover {
    box-shadow: var(--shadow-sm);
    border-color: color-mix(in srgb, var(--accent) 45%, var(--border-color));
  }
  .chip.interactive:active { transform: translateY(1px); }

  /* missing: dashed-рамка + muted-имя; категория остаётся видимой */
  .chip.missing { border-style: dashed; }
  .chip.missing .name { color: var(--text-muted); }

  /* popover — без изменений */
  .chip-popover-backdrop { position: fixed; inset: 0; z-index: 1000; }
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
    min-width: 200px;
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
  }
  .chip-popover.below { bottom: auto; top: calc(100% + 6px); }
  .chip-popover.align-right { left: auto; right: 0; }

  .pop-title {
    font-family: ui-monospace, monospace;
    font-size: var(--font-size-sm);
    font-weight: 600;
    color: var(--text-primary);
    padding: 0 var(--space-xs);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .pop-btn {
    padding: var(--space-xs) var(--space-sm);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    background: var(--bg-surface-hover);
    color: var(--text-primary);
    font-size: var(--font-size-sm);
    cursor: pointer;
    text-align: start;
  }
  .pop-btn:hover { background: var(--bg-surface-active); }
  .pop-btn.primary {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--accent-text);
  }
  .pop-btn.primary:hover { filter: brightness(1.1); }
</style>