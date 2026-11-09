<script lang="ts">
  import { usePluginApi } from '../../../plugin-sdk/src/svelte/index';

  import HeaderHelp from '../header-help/HeaderHelp.svelte';
  import {
    getKlipperErrorHint,
    getKlipperErrorHintUi,
    matchKlipperError,
    type KlipperErrorHintId,
  } from './catalog.ts';

  let {
    message = '',
    hintId = null,
    compact = false,
  }: {
    message?: string;
    hintId?: KlipperErrorHintId | string | null;
    compact?: boolean;
  } = $props();

  const api = usePluginApi();

  // Resolve the stable id first so changing locale only replaces the displayed copy.
  let resolvedId = $derived(hintId ?? matchKlipperError(message));
  let hint = $derived(resolvedId ? getKlipperErrorHint(resolvedId, api.i18n.locale) : null);
  let ui = $derived(getKlipperErrorHintUi(api.i18n.locale));
</script>

{#if hint}
  <span class="klipper-error-help" class:compact>
    <HeaderHelp title={ui.open} {compact}>
      <div class="hint" dir="auto">
        <div class="hint-title">{hint.title}</div>
        <code class="hint-signature" dir="ltr">{hint.signature}</code>
        <p>{hint.summary}</p>
        <h4>{ui.checks}</h4>
        <ul>
          {#each hint.checks as check (check)}
            <li>{check}</li>
          {/each}
        </ul>
      </div>
    </HeaderHelp>
  </span>
{/if}

<style>
  .klipper-error-help {
    display: inline-flex;
    flex: 0 0 auto;
    vertical-align: middle;
    white-space: normal;
  }

  .klipper-error-help.compact {
    margin-inline-start: 2px;
  }

  .hint {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: var(--space-sm);
    text-align: start;
  }

  .hint-title {
    color: var(--text-primary);
    font-weight: 600;
  }

  .hint-signature {
    align-self: flex-start;
    max-width: 100%;
    overflow-wrap: anywhere;
  }

  .hint p,
  .hint h4,
  .hint ul {
    margin-block: 0;
  }
</style>
