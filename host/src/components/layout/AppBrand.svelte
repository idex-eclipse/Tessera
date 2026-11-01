<script lang="ts">
  import { untrack } from 'svelte';

  import { createTesseract, type TesseractHandle } from '../../../../plugins/shared/loader/tesseract';
  import { getAppContext } from '../../app-context.ts';

  let { collapsed }: { collapsed: boolean } = $props();

  const { i18n, ui } = getAppContext();

  let svg: SVGSVGElement;
  let handle: TesseractHandle | undefined;
  let stopped = $derived(!ui.logoAnimated);

  // Логотип — тот же тессеракт, что и в загрузчике, но без подписи и role="status":
  // это декоративная марка, а не индикатор загрузки. Клик останавливает его в позе
  // host/public/logo.svg, повторный — снова запускает вращение. Выбор хранится в
  // настройках, поэтому после F5 логотип сразу стоит или крутится, как оставили.
  $effect(() => {
    // Начальное состояние читается без подписки: дальше им управляет сам тессеракт.
    handle = createTesseract(svg, { parked: untrack(() => stopped) });
    return () => {
      handle?.destroy();
      handle = undefined;
    };
  });

  const toggle = () => {
    if (handle) ui.setLogoAnimated(!handle.toggle());
  };

  let label = $derived(i18n.t(stopped ? 'nav.playLogoAnimation' : 'nav.stopLogoAnimation'));
</script>

<div class="brand" class:collapsed>
  <div class="logo">
    <button type="button" class="logo-mark" aria-pressed={stopped} aria-label={label} title={label} onclick={toggle}>
      <svg bind:this={svg} class="logo-cube" aria-hidden="true" focusable="false"></svg>
    </button>
    {#if !collapsed}
      <a class="logo-text" href="#/" title="Tessera">TESSERA</a>
    {/if}
  </div>
</div>

<style>
  .brand {
    width: var(--sidebar-w);
    height: var(--header-height);
    display: flex;
    align-items: center;
    padding: 0 var(--space-sm);
    background: var(--bg-header);
    border-inline-end: 1px solid rgba(255, 255, 255, 0.08);
    flex-shrink: 0;
    overflow: hidden;
    transition: width var(--transition-normal);
  }

  .brand.collapsed {
    justify-content: center;
    padding: 0;
  }

  .logo {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    color: var(--text-on-header);
    white-space: nowrap;
  }

  .logo-mark {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    padding: 0;
    border: 0;
    background: none;
    color: var(--accent);
    cursor: pointer;
    flex-shrink: 0;
  }

  .logo-cube {
    display: block;
    width: 100%;
    height: 100%;
    overflow: visible;
  }

  .logo-cube :global(line) {
    stroke: currentColor;
    stroke-width: 4.5;
    stroke-linecap: round;
  }

  .logo-text {
    font-weight: 700;
    font-size: var(--font-size-lg);
    letter-spacing: 0.5px;
    color: inherit;
    text-decoration: none;
  }
</style>
