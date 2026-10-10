<script lang="ts">
  import { useI18n } from '../../../../plugin-sdk/src/svelte/index';

  import type { MacroParam } from '../../../shared/macro-params';

  let {
    name,
    params,
    anchor,
    onRun,
    onClose,
  }: {
    name: string;
    params: MacroParam[];
    anchor: { left: number; top: number; bottom: number };
    onRun: (values: Record<string, string>) => void;
    onClose: () => void;
  } = $props();

  const i18n = useI18n();

  let values = $state<Record<string, string>>({});
  let el = $state<HTMLDivElement | null>(null);
  let pos = $state({ x: -9999, y: -9999 });

  let hasRequired = $derived(params.some((p) => p.required));

  // flip у краёв экрана — как edit-popover макросов
  $effect(() => {
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const x = Math.max(8, Math.min(anchor.left, window.innerWidth - w - 8));
    let y = anchor.bottom + 4;
    if (y + h > window.innerHeight - 8) {
      y = anchor.top - h - 4;
      if (y < 8) y = 8;
    }
    pos = { x, y };
  });

  function errorOf(p: MacroParam): string | null {
    const t = (values[p.name] ?? '').trim();
    if (!t) return p.required ? i18n.t('widgets.macros.paramsRequired') : null;
    if (p.type === 'int' && !/^-?\d+$/.test(t)) return i18n.t('widgets.macros.paramsInt');
    if (p.type === 'float' && !/^-?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(t))
      return i18n.t('widgets.macros.paramsFloat');
    return null;
  }

  let invalid = $derived.by(() => params.some((p) => errorOf(p) !== null));

  function submit(): void {
    if (invalid) return;
    onRun(values);
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    }
  }
</script>

<div class="mpm-backdrop" onclick={onClose} role="presentation"></div>

<div
  class="mpm"
  bind:this={el}
  style:left="{pos.x}px"
  style:top="{pos.y}px"
  onkeydown={onKey}
>
  <div class="mpm-title">{name}</div>

  {#each params as p (p.name)}
    {@const err = errorOf(p)}
    {@const showErr = err !== null && (values[p.name] ?? '').trim() !== ''}
    <label class="mpm-field">
      <span class="mpm-label">
        {p.name}
        <span class="mpm-type">{p.type}</span>
        {#if p.required}<span class="mpm-req">*</span>{/if}
      </span>
      <input
        class="mpm-input"
        class:invalid={showErr}
        type="text"
        placeholder={p.def ?? ''}
        inputmode={p.type === 'int' || p.type === 'float' ? 'decimal' : 'text'}
        bind:value={values[p.name]}
      />
      {#if showErr}<span class="mpm-err">{err}</span>{/if}
    </label>
  {/each}

  <div class="mpm-foot">
    {#if hasRequired}
      <span class="mpm-req-note">{i18n.t('widgets.macros.paramsRequired')}</span>
    {/if}
    <button class="mpm-run" disabled={invalid} onclick={submit}>
      {i18n.t('widgets.macros.paramsRun')}
    </button>
  </div>
</div>

<style>
  .mpm-backdrop {
    position: fixed;
    inset: 0;
    z-index: 460;
    background: transparent;
  }

  .mpm {
    position: fixed;
    z-index: 461;
    width: 250px;
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
    padding: var(--space-sm);
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-lg);
  }

  .mpm-title {
    font-family: monospace;
    font-size: var(--font-size-sm);
    font-weight: 600;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .mpm-field {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .mpm-label {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
    font-family: monospace;
  }

  .mpm-type {
    padding: 0 6px;
    border-radius: 999px;
    background: var(--bg-surface-hover);
    color: var(--text-muted);
    font-size: var(--font-size-sm);
  }

  .mpm-req { color: var(--danger); }

  .mpm-input {
    padding: var(--space-xs) var(--space-sm);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    background: var(--bg-app);
    color: var(--text-primary);
    font-size: var(--font-size-sm);
    font-family: monospace;
  }

  .mpm-input:focus { outline: none; border-color: var(--border-focus); }
  .mpm-input.invalid { border-color: var(--danger); }

  .mpm-err { font-size: var(--font-size-sm); color: var(--danger); }

  .mpm-foot {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-sm);
    padding-top: 2px;
  }

  .mpm-req-note {
    margin-inline-end: auto;
    font-size: var(--font-size-sm);
    color: var(--danger);
  }

  .mpm-run {
    padding: var(--space-xs) var(--space-md);
    border: none;
    border-radius: var(--radius-sm);
    background: var(--accent);
    color: #fff;
    font-size: var(--font-size-sm);
    cursor: pointer;
  }

  .mpm-run:hover:not(:disabled) { filter: brightness(1.1); }
  .mpm-run:disabled { opacity: 0.5; cursor: not-allowed; }
</style>