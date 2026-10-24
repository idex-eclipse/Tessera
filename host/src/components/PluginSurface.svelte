<script lang="ts">
  import { getAppContext } from '../app-context';
  import { getPluginApi } from '../core/plugin-api-cache';
  import PluginElementHost from './plugin-element-host.svelte';

  /**
   * Универсальный монтировщик вклада плагина: резолвит api плагина-владельца
   * через общий кэш и рендерит Custom Element. Используется всеми поверхностями
   * (pages/widgets/banners/overlays/chips/printerPanels/rightPanel).
   * Пока плагин не загружен — ничего не рендерится.
   */
  let {
    pluginId,
    tag,
    params = {},
    fill = true,
    allowUnloaded = false,
  }: {
    pluginId: string;
    tag: string;
    params?: Record<string, string>;
    fill?: boolean;
    allowUnloaded?: boolean;
  } = $props();

  const ctx = getAppContext();

  let api = $derived(getPluginApi(ctx, pluginId, { allowUnloaded }));
</script>

{#if api}
  <PluginElementHost {tag} {api} {params} {fill} />
{/if}
