<script lang="ts">
  import Icon from '../icons/Icon.svelte';

  let { collapsed }: { collapsed: boolean } = $props();
</script>

<div class="brand" class:collapsed>
  <a class="logo" href="#/" title="Tessera">
    <span class="logo-mark">
      <Icon name="printer" size={16} />
    </span>
    {#if !collapsed}
      <span class="logo-text">TESSERA</span>
    {/if}
  </a>
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
    text-decoration: none;
    white-space: nowrap;
  }

  .logo-mark {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: var(--radius-md);
    background: var(--accent);
    color: #fff;
    flex-shrink: 0;
  }

  .logo-text {
    font-weight: 700;
    font-size: var(--font-size-lg);
    letter-spacing: 0.5px;
  }
</style>