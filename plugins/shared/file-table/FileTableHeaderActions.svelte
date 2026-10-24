<script lang="ts">
  import { usePluginApi } from '../../../plugin-sdk/src/svelte/index';

  import ContextMenu, { type ContextMenuItem } from '../context-menu.svelte';
  import Icon from '../icons/Icon.svelte';
  import PromptDialog from '../prompt-dialog.svelte';
  import { createFileOps } from './file-ops';

  import { COLUMNS, PAGE_DEFAULTS, WIDGET_DEFAULTS } from './columns';
  import {
    ensureColumnsLoaded, getCurrentPath, getSearch, getVisibleColumns,
    getSearchFocusTick, requestRefresh, setNotice, setSearch, setVisibleColumns,
  } from './file-table-state.svelte';

  let {
    scope,
    mode,
    root = 'gcodes',
    showAdd = false,
    menuEnabled = true,
    onThreeMF = null,  // НОВОЕ
  }: {
    scope: string;
    mode: 'gcode' | 'simple'|'history';
    root?: string;
    showAdd?: boolean;
    menuEnabled?: boolean;
    onThreeMF?: ((file: File) => void) | null;  // НОВОЕ
  } = $props();

  const api = usePluginApi();
  const i18n = api.i18n;
  const ops = createFileOps(api);

  let columnsOpen = $state(false);
  let addMenu = $state<{ x: number; y: number } | null>(null);
  let filesInput = $state<HTMLInputElement | null>(null);
  let folderInput = $state<HTMLInputElement | null>(null);
  let createFileOpen = $state(false);
  let createDirOpen = $state(false);

  let search = $derived(getSearch(api, scope));

  /** Текст ошибки: отказ гарда → перевод reasonKey, иначе message. */
  function errText(e: unknown): string {
    const reasonKey = (e as { rejection?: { reasonKey?: string } } | null)?.rejection?.reasonKey;
    if (reasonKey) return i18n.t(reasonKey);
    return e instanceof Error ? e.message : String(e);
  }

  // Внешний запрос фокуса на поиск (hotkey Ctrl+F плагина вместо поиска браузера)
  let searchEl = $state<HTMLInputElement | null>(null);
  let lastFocusTick = getSearchFocusTick(api, scope);
  $effect(() => {
    const tick = getSearchFocusTick(api, scope);
    if (tick === lastFocusTick) return;
    lastFocusTick = tick;
    searchEl?.focus();
    searchEl?.select();
  });

  ensureColumnsLoaded(api, scope);
  $effect(() => {
    void api.printer.id;
    ensureColumnsLoaded(api, scope);
  });

  const allKeys = COLUMNS.map((c) => c.key);
  let visibleKeys = $derived(
    getVisibleColumns(api, scope, allKeys, scope.startsWith('widget') ? WIDGET_DEFAULTS : PAGE_DEFAULTS),
  );

  function toggleColumn(key: string): void {
    const cur = visibleKeys;
    let next = cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key];
    if (!next.includes('name')) next = ['name', ...next];
    setVisibleColumns(api, scope, next);
  }

  const addItems = $derived.by<ContextMenuItem[]>(() => [
    { id: 'upload_files', label: i18n.t('ft.uploadFiles'), icon: 'upload' },
    { id: 'upload_folder', label: i18n.t('ft.uploadFolder'), icon: 'folder-up' },
    { id: 'create_file', label: i18n.t('ft.createFile'), icon: 'file-plus' },
    { id: 'create_folder', label: i18n.t('ft.createFolder'), icon: 'folder-plus' },
  ]);

  function openAddMenu(e: MouseEvent): void {
    e.stopPropagation();
    addMenu = { x: e.clientX, y: e.clientY };
  }

  function onAddSelect(id: string): void {
    if (id === 'upload_files') filesInput?.click();
    else if (id === 'upload_folder') folderInput?.click();
    else if (id === 'create_file') createFileOpen = true;
    else if (id === 'create_folder') createDirOpen = true;
  }

  async function onFilesPicked(e: Event): Promise<void> {
    const input = e.currentTarget as HTMLInputElement;
    const list = input.files;
    input.value = '';
    if (!list || list.length === 0) return;
    const dir = getCurrentPath(api, scope);
    try {
      for (const f of Array.from(list)) {
        // Перехват .3mf файлов — открываем инспектор вместо загрузки
        if (f.name.toLowerCase().endsWith('.3mf') && onThreeMF) {
          onThreeMF(f);
          continue;
        }
        await ops.upload(root, dir, f);
      }
      setNotice(api, scope, null);
    } catch (err) {
      setNotice(api, scope, errText(err));
    }
  }

  async function onFolderPicked(e: Event): Promise<void> {
    const input = e.currentTarget as HTMLInputElement;
    const list = input.files;
    input.value = '';
    if (!list || list.length === 0) return;
    const base = getCurrentPath(api, scope);
    try {
      for (const f of Array.from(list)) {
        const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath ?? f.name;
        const relDir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
        await ops.upload(root, [base, relDir].filter(Boolean).join('/'), f);
      }
      setNotice(api, scope, null);
    } catch (err) {
      setNotice(api, scope, errText(err));
    }
  }

  async function handleCreateFile(name: string): Promise<void> {
    try {
      await ops.createFile(root, getCurrentPath(api, scope), name);
      setNotice(api, scope, null);
    } catch (e) { setNotice(api, scope, errText(e)); }
  }

  async function handleCreateDir(name: string): Promise<void> {
    try {
      const base = getCurrentPath(api, scope);
      await ops.createDirectory(root, base ? `${base}/${name}` : name);
      setNotice(api, scope, null);
    } catch (e) { setNotice(api, scope, errText(e)); }
  }
</script>

<svelte:window onclick={() => (columnsOpen = false)} />

<div class="ha-wrap" onclick={(e) => e.stopPropagation()}>
  <input
    class="ha-search"
    placeholder={i18n.t('ft.search')}
    dir="auto"
    bind:this={searchEl}
    value={search}
    oninput={(e) => setSearch(api, scope, e.currentTarget.value)}
  />

  <button class="icon-btn" title={i18n.t('ft.refresh')} onclick={() => requestRefresh(api, scope)}>
    <Icon name="refresh" />
  </button>

  {#if showAdd && menuEnabled}
    <button class="icon-btn" title={i18n.t('common.add')} onclick={openAddMenu}>
      <Icon name="plus" />
    </button>
  {/if}

  {#if mode !== 'simple'}
    <button class="icon-btn" title={i18n.t('ft.columns')} onclick={() => (columnsOpen = !columnsOpen)}>
      <Icon name="columns" />
    </button>

    {#if columnsOpen}
      <div class="dropdown">
        {#each COLUMNS as col (col.key)}
          <label class="dropdown-item">
            <input
              type="checkbox"
              disabled={col.always}
              checked={visibleKeys.includes(col.key)}
              onchange={() => toggleColumn(col.key)}
            />
            {i18n.t(col.labelKey)}
          </label>
        {/each}
      </div>
    {/if}
  {/if}

  {#if addMenu}
    <ContextMenu x={addMenu.x} y={addMenu.y} items={addItems} onSelect={onAddSelect} onClose={() => (addMenu = null)} />
  {/if}

  <input hidden type="file" multiple bind:this={filesInput} onchange={onFilesPicked} />
  <input hidden type="file" multiple webkitdirectory bind:this={folderInput} onchange={onFolderPicked} />

  <PromptDialog open={createFileOpen} title={i18n.t('ft.createFile')} confirmLabel={i18n.t('common.add')} onSubmit={handleCreateFile} onClose={() => (createFileOpen = false)} />
  <PromptDialog open={createDirOpen} title={i18n.t('ft.createFolder')} confirmLabel={i18n.t('common.add')} onSubmit={handleCreateDir} onClose={() => (createDirOpen = false)} />
</div>

<style>
  .ha-wrap { position: relative; display: flex; align-items: center; gap: var(--space-xs); }
  .ha-search { width: 150px; padding: var(--space-xs) var(--space-sm); border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: var(--bg-surface); color: var(--text-primary); font-size: var(--font-size-sm); }
  .ha-search:focus { outline: none; border-color: var(--border-focus); }
  .icon-btn { display: flex; align-items: center; justify-content: center; width: 28px; height: 28px; border: none; border-radius: var(--radius-sm); background: transparent; color: var(--text-muted); cursor: pointer; flex-shrink: 0; }
  .icon-btn:hover { background: var(--bg-surface-hover); color: var(--text-primary); }
  .dropdown { position: absolute; inset-inline-end: 0; top: calc(100% + 4px); z-index: 60; min-width: 230px; max-height: 340px; overflow-y: auto; background: var(--bg-surface); border: 1px solid var(--border-color); border-radius: var(--radius-md); box-shadow: var(--shadow-lg); padding: var(--space-xs); display: flex; flex-direction: column; }
  .dropdown-item { display: flex; align-items: center; gap: var(--space-sm); padding: var(--space-xs) var(--space-sm); border-radius: var(--radius-sm); cursor: pointer; font-size: var(--font-size-sm); color: var(--text-primary); }
  .dropdown-item:hover { background: var(--bg-surface-hover); }
</style>