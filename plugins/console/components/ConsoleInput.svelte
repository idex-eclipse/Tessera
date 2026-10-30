<script lang="ts">
  import { untrack } from 'svelte';

  import { usePluginApi } from '../../../plugin-sdk/src/svelte/index';

  import { letterSignature, namedParams, paramTypeLabel } from '../../shared/gcode-hints/catalog';
  import { suggestForLine, type HintSuggestion } from '../../shared/gcode-hints/suggest';
  import type { Catalog } from '../../shared/gcode-hints/types';

  import { isPrinting } from '../console-session.svelte';
  import { consoleUi } from '../page-ui-state.svelte';
  import { breaksPrint } from '../print-safety';

  const i18n = usePluginApi().i18n;

  let {
    disabled,
    catalog,
    history,
    printerId,
    placeholder = '',
    above = true,
    onSend,
    fillTrigger = null,
  }: {
    disabled: boolean;
    catalog: Catalog;
    history: string[];
    printerId: string;
    placeholder?: string;
    above: boolean;
    onSend: (script: string) => void;
    fillTrigger?: { text: string; ts: number } | null;
  } = $props();

  let input = $state('');
  let highlight = $state(0);
  let dismissed = $state(false);
  let historyIndex = $state(-1);
  let inputEl = $state<HTMLInputElement | null>(null);
  /** Скрипт, перезапуск которым при печати уже предупредили (нужен повторный Enter). */
  let armed = $state<string | null>(null);

  /** Стрелками выбирали подсказку — тогда Enter принимает и «пассивный» список. */
  let navigated = $state(false);

  let hint = $derived(
    dismissed || disabled
      ? { items: [] as HintSuggestion[], replaceStart: 0, passive: false }
      : suggestForLine(catalog, input, { substring: true }),
  );
  let suggestions = $derived(hint.items);

  // сброс выбора при каждом изменении ввода
  $effect(() => {
    void input;
    highlight = 0;
    dismissed = false;
    navigated = false;
    // правка текста снимает «взвод» подтверждения
    if (untrack(() => armed) !== null && input.trim() !== untrack(() => armed)) armed = null;
  });

  // fillTrigger: imperative fill через reactive prop
  $effect(() => {
    if (fillTrigger) {
      input = fillTrigger.text;
      inputEl?.focus();
    }
  });

  // Alt+I: фокус в поле ввода (счётчик из hotkeys; последнее виденное значение — вне реактивности)
  let seenFocusSeq = untrack(() => consoleUi.focusInputSeq);
  $effect(() => {
    const seq = consoleUi.focusInputSeq;
    if (seq === seenFocusSeq) return;
    seenFocusSeq = seq;
    inputEl?.focus();
  });

  function accept(s: HintSuggestion): void {
    // токен под кареткой (команда, NAME= или значение) заменяется целиком
    input = input.slice(0, hint.replaceStart) + s.insert;
    inputEl?.focus();
  }

  function send(): void {
    const script = input.trim();
    if (!script || disabled) return;

    // RESTART / FIRMWARE_RESTART при идущей печати: первый Enter предупреждает, второй отправляет.
    // (Свои запросы плагина GuardAgent не проверяет — защита в интерфейсе.)
    if (isPrinting(printerId) && breaksPrint(script) && armed !== script) {
      armed = script;
      return;
    }

    armed = null;
    input = '';
    historyIndex = -1;
    onSend(script);
  }

  function onKeydown(e: KeyboardEvent): void {
    if (suggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        navigated = true;
        highlight = (highlight + 1) % suggestions.length;
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        navigated = true;
        highlight = (highlight - 1 + suggestions.length) % suggestions.length;
        return;
      }
      // «Пассивный» список (сразу после пробела или «=») Enter не перехватывает:
      // иначе нельзя отправить `G28 ` или `START_PRINT `. Tab принимает всегда.
      const takesEnter = !hint.passive || navigated;
      if (e.key === 'Tab' || (e.key === 'Enter' && takesEnter)) {
        e.preventDefault();
        const s = suggestions[highlight] ?? suggestions[0];
        if (s) accept(s);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        dismissed = true;
        return;
      }
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      send();
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (history.length === 0) return;
      historyIndex =
        historyIndex === -1 ? history.length - 1 : Math.max(0, historyIndex - 1);
      input = history[historyIndex] ?? '';
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndex === -1) return;
      const idx = historyIndex + 1;
      if (idx >= history.length) {
        historyIndex = -1;
        input = '';
      } else {
        historyIndex = idx;
        input = history[idx] ?? '';
      }
    }
  }
</script>

<div class="console-input-wrap">
  {#if suggestions.length > 0}
    <ul class="autocomplete" class:below={!above} role="listbox">
      {#each suggestions as s, i (s.kind + s.label)}
        <li>
          <button
            type="button"
            class="ac-item"
            class:active={i === highlight}
            onmouseenter={() => (highlight = i)}
            onclick={() => accept(s)}
          >
            <span class="ac-cmd">{s.label}</span>
            {#if s.kind === 'command' && s.command && letterSignature(s.command)}
              <span class="ac-sig">({letterSignature(s.command)})</span>
            {/if}
            {#if s.kind === 'param' && s.param}
              <span class="ac-help">
                {paramTypeLabel(s.param)}
                {#if s.param.def != null}= {s.param.def}{/if}
                {#if s.param.required}<span class="ac-req">*</span>{/if}
                {#if s.description}— {s.description}{/if}
              </span>
            {:else if s.description}
              <span class="ac-help">{s.description}</span>
            {/if}
          </button>

          {#if s.kind === 'command' && s.command && namedParams(s.command).length > 0}
            <div class="ac-params">
              {#each namedParams(s.command) as p (p.name)}
                <span class="param-chip" class:req={p.required}>
                  <span class="p-name">{p.name}</span>
                  {#if paramTypeLabel(p)}<span class="p-type">{paramTypeLabel(p)}</span>{/if}
                  {#if p.def != null}<span class="p-def">={p.def}</span>{/if}
                </span>
              {/each}
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}

  <input
    class="console-input"
    dir="ltr"
    {placeholder}
    bind:value={input}
    bind:this={inputEl}
    onkeydown={onKeydown}
    disabled={disabled}
    spellcheck="false"
    autocomplete="off"
    autocapitalize="off"
  />

  {#if armed !== null}
    <p class="restart-warn" role="alert">{i18n.t('console.confirmRestart')}</p>
  {/if}
</div>

<style>
  .console-input-wrap {
    position: relative;
  }

  .autocomplete {
    position: absolute;
    inset-inline: 0;
    bottom: calc(100% + 4px);
    direction: ltr; /* команды и сигнатуры G-code — всегда слева направо */
    margin: 0;
    padding: var(--space-xs);
    list-style: none;
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-md);
    max-height: min(240px, 35dvh);
    overflow-y: auto;
    z-index: 50;
  }

  .autocomplete.below {
    bottom: auto;
    top: calc(100% + 4px);
  }

  .ac-item {
    display: flex;
    gap: var(--space-sm);
    align-items: baseline;
    width: 100%;
    border: none;
    background: transparent;
    padding: var(--space-xs) var(--space-sm);
    border-radius: var(--radius-sm);
    cursor: pointer;
    text-align: start;
    font-family: monospace;
    font-size: var(--font-size-sm);
  }

  .ac-item.active {
    background: var(--bg-surface-active);
  }

  .ac-cmd {
    color: var(--accent);
    font-weight: 600;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .ac-sig {
    color: var(--text-muted);
    font-size: 11px;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .ac-help {
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .console-input {
    width: 100%;
    padding: var(--space-sm) var(--space-md);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    background: var(--bg-surface);
    color: var(--text-primary);
    font-family: monospace;
    font-size: var(--font-size-md);
  }

  .console-input:focus {
    outline: none;
    border-color: var(--border-focus);
  }

  .ac-params {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    padding: 2px var(--space-sm) var(--space-xs);
    margin-top: -2px;
  }

  .restart-warn {
    margin: var(--space-xs) 0 0;
    color: var(--warning);
    font-size: var(--font-size-sm);
  }

  .ac-req {
    color: var(--warning);
    font-weight: 700;
  }

  .param-chip {
    display: inline-flex;
    align-items: baseline;
    gap: 2px;
    padding: 1px 6px;
    border-radius: 999px;
    background: var(--bg-surface-hover);
    font-size: var(--font-size-sm);
    font-family: monospace;
  }

  .param-chip.req {
    background: color-mix(in srgb, var(--warning) 15%, transparent);
  }

  .p-name {
    color: var(--text-primary);
    font-weight: 600;
  }

  .p-type {
    color: var(--text-muted);
    font-size: var(--font-size-sm);
  }

  .p-def {
    color: var(--accent);
  }

  /* узкий контейнер (страница или виджет): строки автодополнения переносятся */
  @container (max-width: 480px) {
    .ac-item { flex-wrap: wrap; row-gap: 0; }
    .ac-sig { white-space: normal; }
    .ac-help { white-space: normal; }
  }

  @media (pointer: coarse) {
    .ac-item { min-height: 40px; align-items: center; }
  }
</style>
