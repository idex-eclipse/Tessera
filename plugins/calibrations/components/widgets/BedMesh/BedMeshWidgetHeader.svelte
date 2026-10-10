<script lang="ts">
  import { usePluginApi } from '../../../../../plugin-sdk/src/svelte/index';

  import Icon from '../../../../shared/icons/Icon.svelte';

  import { useBedMesh, type BedMeshTools } from '../../../use-bed-mesh.svelte.ts';
  import { bedMeshUiState } from '../../../bed-mesh-ui-state.svelte.ts';
  import { gcode, runGcode } from '../../../commands.ts';

  import { useKlippyState } from '../../../../shared/klippy-state/use-klippy-state.svelte.ts';

  const api = usePluginApi();
  const i18n = api.i18n;
  const store = useBedMesh(api);
  const klippy = useKlippyState(api);  

  let pageHref = $derived(`#/p/${api.printer.id}/bed-mesh`);

  let busy = $state('');
  let menuOpen = $state(false);
  let btnEl = $state<HTMLButtonElement | null>(null);
  let menuPos = $state({ top: 0, left: 0 });
  let menuRtl = $state(false);

  const TOOLS: Array<{ key: keyof BedMeshTools; labelKey: string; script: string }> = [
    { key: 'zTilt', labelKey: 'bedMesh.tools.zTilt', script: gcode.zTiltAdjust },
    { key: 'qgl', labelKey: 'bedMesh.tools.qgl', script: gcode.quadGantryLevel },
    { key: 'screws', labelKey: 'bedMesh.tools.screws', script: gcode.screwsTiltCalculate },
  ];

  let visible = $derived(TOOLS.filter((t) => store.tools[t.key]));

  function toggleMenu(): void {
    if (!menuOpen && btnEl) {
      const r = btnEl.getBoundingClientRect();
      menuRtl = document.documentElement.getAttribute('dir') === 'rtl';
      menuPos = {
        top: r.bottom + 4,
        left: menuRtl ? r.left : r.right,
      };
    }
    menuOpen = !menuOpen;
  }

  function closeMenu(): void {
    menuOpen = false;
  }

  async function run(toolKey: string, script: string): Promise<void> {
    if (busy) return;
    closeMenu();

    // MANUAL_PROBE: скрипт висит до конца сессии зондирования — не await
    if (toolKey === 'manualProbe') {
      busy = toolKey;
      runGcode(api.moonraker(), script)
        .catch((e) => console.error('[bed-mesh] gcode failed:', script, e))
        .finally(() => {
          busy = '';
        });
      setTimeout(() => void store.refresh(), 400);
      return;
    }

    busy = toolKey;
    try {
      await runGcode(api.moonraker(), script);
      await store.refresh();
      if (toolKey === 'screws') bedMeshUiState.screwsOverlayOpen = true;
    } catch (e) {
      console.error('[bed-mesh] gcode failed:', script, e);
    } finally {
      busy = '';
    }
  }
</script>

<div class="header-actions">
  {#if visible.length > 0}
    <button
      class="hdr-btn"
      bind:this={btnEl}
      disabled={busy !== '' || !klippy.ready}
      onclick={toggleMenu}
      title={!klippy.ready ? i18n.t('common.klipperNotReady') : i18n.t('bedMesh.widget.tools')}
    >
      {#if busy !== ''}
        <span class="spinner" aria-hidden="true"></span>
      {:else}
        <Icon name="tool" size={15} />
      {/if}
    </button>

    {#if menuOpen}
      <div class="menu-backdrop" onclick={closeMenu} role="presentation"></div>

      <div
        class="menu"
        style="top: {menuPos.top}px; left: {menuPos.left}px; transform: {menuRtl ? 'none' : 'translateX(-100%)'}"
        role="menu"
      >
        {#each visible as tool (tool.key)}
          <button
            class="menu-item"
            role="menuitem"
            disabled={busy !== '' || !klippy.ready}
            onclick={() => run(tool.key, tool.script)}
          >
            <span class="item-label">{i18n.t(tool.labelKey)}</span>
            {#if busy === tool.key}
              <span class="spinner" aria-hidden="true"></span>
            {/if}
          </button>
        {/each}
      </div>
    {/if}
  {/if}

  <!-- Open Page: всегда доступен, даже если инструментов в конфиге нет -->
  <a class="hdr-btn" href={pageHref} title={i18n.t('bedMesh.widget.openPage')}>
    <Icon name="expand" size={15} />
  </a>
</div>

<style>
  .header-actions {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
  }

  .hdr-btn {
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
    transition: background var(--transition-fast), color var(--transition-fast);
  }

  a.hdr-btn {
    text-decoration: none;
  }

  .hdr-btn:hover:not(:disabled) {
    background: var(--bg-surface-hover);
    color: var(--text-primary);
  }

  .hdr-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  /* fixed-меню не режется overflow'ом карточки виджета */
  .menu-backdrop {
    position: fixed;
    inset: 0;
    z-index: 390;
  }

  .menu {
    position: fixed;
    z-index: 400;
    min-width: 230px;
    max-width: 320px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: var(--space-xs);
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-lg);
  }

  .menu-item {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    padding: var(--space-xs) var(--space-sm);
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-primary);
    font-size: var(--font-size-sm);
    text-align: start;
    cursor: pointer;
  }

  .menu-item:hover:not(:disabled) {
    background: var(--bg-surface-hover);
  }

  .menu-item:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .item-label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .spinner {
    width: 12px;
    height: 12px;
    border: 2px solid var(--border-color);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    flex-shrink: 0;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>