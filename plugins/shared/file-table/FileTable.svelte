<script lang="ts">
  import type { Snippet } from 'svelte';

  import { ExtensionPoint, usePluginApi } from '../../../plugin-sdk/src/svelte/index';
  import type { MpuParams } from '../../../plugin-sdk/src/types';

  import ConfirmDialog from '../confirm-dialog.svelte';
  import ContextMenu, { type ContextMenuItem } from '../context-menu.svelte';
  import Icon from '../icons/Icon.svelte';
  import Loader from '../loader/Loader.svelte';
  import PromptDialog from '../prompt-dialog.svelte';
  import TextEditorDialog from '../text-editor-dialog/text-editor-dialog.svelte';
  import ImageViewerDialog from '../image-viewer-dialog/image-viewer-dialog.svelte';

  import { configBackupRef, createFileOps, fullPath, type FileRef } from './file-ops';
  import { checkConfigRestart } from './config-restart';
  import { diffConfigLines, type ConfigDiffLine } from './config-diff';
  import ConfigBackupDialog from './ConfigBackupDialog.svelte';
  import { FILE_TABLE_POINT_IDS } from './extension-points';
  import { formatDate, formatSize } from '../format';

  import { COLUMNS, PAGE_DEFAULTS, WIDGET_DEFAULTS, type ColumnDef } from './columns';
  import {
    ensureColumnsLoaded, getNotice, getRefreshTick, getSearch, getVisibleColumns,
    setCurrentPath, setVisibleColumns, setNotice, getSort, setSort,
  } from './file-table-state.svelte';
  import { useDirFiles } from './use-dir-files.svelte';
  import { useGcodeFiles, type GcodeFileEntry } from './use-gcode-files.svelte';
  import { useHistoryFiles } from './use-history-files.svelte';

  import FileTableHeaderActions from './FileTableHeaderActions.svelte';

  import { fileCap } from './file-capabilities';

let {
  root,
  scope,
  mode,
  title,
  showHeader = true,
  showAdd = false,
  menuItems,
  onAction,
  headerExtra = null,
  menuEnabled = true,
  onThreeMF = null,  // НОВОЕ: колбэк для перехвата .3mf файлов
}: {
  root: string;
  scope: string;
  mode: 'gcode' | 'simple'|'history';
  title?: string;
  showHeader?: boolean;
  showAdd?: boolean;
  menuItems?: (ref: FileRef, isDir: boolean) => ContextMenuItem[];
  onAction?: (id: string, ref: FileRef) => void | Promise<void>;
  headerExtra?: Snippet | null;
  menuEnabled?: boolean;
  onThreeMF?: ((file: File) => void) | null;  // НОВОЕ
} = $props();

  const api = usePluginApi();
  const i18n = api.i18n;
  const ops = createFileOps(api);

  /** Текст ошибки для пользователя: отказ гарда → перевод reasonKey, иначе message. */
  function errText(e: unknown): string {
    const reasonKey = (e as { rejection?: { reasonKey?: string } } | null)?.rejection?.reasonKey;
    if (reasonKey) return i18n.t(reasonKey);
    if (e instanceof Error && e.message === 'config.backupInvalid') return i18n.t(e.message);
    return e instanceof Error ? e.message : String(e);
  }

  const gcode = mode === 'gcode' ? useGcodeFiles(api) : null;
  const simple = mode === 'simple' ? useDirFiles(api, root) : null;
  const history = mode === 'history' ? useHistoryFiles(api) : null;

  type FileRow = { name: string; modified: number; size: number } & Record<string, any>;

  interface TableSource {
    path: string;
    dirs: Array<{ dirname: string; modified: number; size: number }>;
    files: any[];
    loading?: boolean;
    error?: string | null;
    navigate(p: string): void;
    refresh(): void | Promise<void>;
    /** row — строка таблицы: история хранит статус на каждое задание, а не на имя файла. */
    statusOf?(filename: string, row?: any): string | null;
  }
  const source = (mode === 'gcode' ? gcode : mode === 'history' ? history : simple) as TableSource;

  const dataPath = $derived(source.path);
  const dataDirs = $derived(source.dirs.map((d) => ({ name: d.dirname, modified: d.modified, size: d.size })));

  let dataFiles = $derived.by<FileRow[]>(() =>
    mode === 'simple'
      ? source.files
          .filter((f) => !!f && typeof f.filename === 'string')
          .map((f) => ({ name: f.filename, modified: f.modified, size: f.size }))
      : source.files
          .filter((f) => !!f && typeof f.filename === 'string')
          .map((f) => ({ ...f, name: f.filename })),
  );

  const loading = $derived(source.loading === true);
  const sourceError = $derived(source.error ?? null);

  ensureColumnsLoaded(api, scope);
  $effect(() => { void api.printer.id; ensureColumnsLoaded(api, scope); });

  // sync path + refresh + search
  $effect(() => { setCurrentPath(api, scope, dataPath); });
  let lastTick = $state(-1);
  $effect(() => {
    const t = getRefreshTick(api, scope);
    if (t !== lastTick) {
      const first = lastTick === -1;
      lastTick = t;
      if (!first) source.refresh();
    }
  });
  let search = $derived(getSearch(api, scope).trim().toLowerCase());
  let notice = $derived(getNotice(api, scope));

  // ---------------- columns ----------------
  const SIMPLE_COLS: ColumnDef[] = [
    { key: 'name', labelKey: 'ft.name' },
    { key: 'modified', labelKey: 'ft.modified' },
    { key: 'size', labelKey: 'ft.size' },
  ];
  const allKeys = COLUMNS.map((c) => c.key);
  let visibleKeys = $derived(
    getVisibleColumns(api, scope, allKeys, scope.startsWith('widget') ? WIDGET_DEFAULTS : PAGE_DEFAULTS),
  );
  let cols = $derived(
    mode === 'simple'
      ? SIMPLE_COLS
      : visibleKeys.map((k) => COLUMNS.find((c) => c.key === k)).filter((c): c is ColumnDef => Boolean(c)),
  );
  let COLSPAN = $derived(cols.length);

  // ---------------- sorting ----------------
  let sort = $derived(getSort(api, scope));
  let sortKey = $derived(sort.key);
  let sortDir = $derived(sort.dir);

  function toggleSort(key: string): void {
    const dir: 1 | -1 =
      sort.key === key
        ? sort.dir === 1 ? -1 : 1
        : key === 'name' || key === 'status' || key === 'filament' ? 1 : -1;
    setSort(api, scope, key, dir);
  }

  function asStrings(v: unknown): string[] { /* как в jobs */ 
    if (v == null) return [];
    if (Array.isArray(v)) return v.map(String).filter(s => s.trim());
    if (typeof v === 'string') {
      const s = v.trim();
      if (s.startsWith('[')) { try { const p = JSON.parse(s); if (Array.isArray(p)) return p.map(String).filter(x=>x.trim()); } catch {} }
      if (s.includes(';')) return s.split(';').map(x=>x.trim()).filter(Boolean);
      return s ? [s] : [];
    }
    return [];
  }
  function asNumbers(v: unknown): number[] { /* как в jobs */ 
    if (v == null) return [];
    let list: unknown[] = Array.isArray(v) ? v : typeof v === 'number' ? [v] : [];
    if (typeof v === 'string') { const s=v.trim(); if (s.startsWith('[')) { try { const p=JSON.parse(s); list=Array.isArray(p)?p:[]; } catch { list=[]; } } else if (s.includes(';')) list=s.split(';'); else { const n=Number(s); return Number.isFinite(n)?[n]:[]; } }
    return list.map(x=>typeof x==='string'?Number(x):x).filter((x):x is number=>typeof x==='number'&&Number.isFinite(x));
  }
  function safeColor(c: string): string { return /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(c)?c:'var(--text-muted)'; }

  function sortValue(f: any, key: string): string | number | null {
    if (mode === 'simple') {
      if (key === 'name') return String(f.name).toLowerCase();
      if (key === 'modified') return f.modified;
      return f.size;
    }
    switch (key) {
      case 'name': return String(f.filename).toLowerCase();
      case 'status': return source.statusOf?.(f.filename, f) ?? '';
      case 'size': return f.size;
      case 'modified': return f.modified;
      case 'thumbnail': return (f.thumbnails?.length ?? 0);
      case 'last_print':
      // в raw поле называется print_start_time (unix ts)
      return (f.raw ?? f).print_start_time ?? null;
      default: {
        const r = f.raw ?? f;

        // строковые/массивные значения (slicer, filament_name, …)
        const strs = asStrings(r[key]);
        if (strs.length) return strs.join(', ').toLowerCase();

        // прямое число (estimated_time, object_height, layer_count, темпы…)
        const direct = r[key];
        if (typeof direct === 'number' && Number.isFinite(direct)) return direct;

        // числовой массив/строка («12;34», [1,2]) — сумма
        const nums = asNumbers(direct);
        if (nums.length) return nums.reduce((a, b) => a + b, 0);

        return null;
      }
    }
  }

  function cmp(a: any, b: any): number {
    if (a === null && b === null) return 0;
    if (a === null) return -1;
    if (b === null) return 1;
    if (typeof a === 'string' || typeof b === 'string')
      return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
    return (a as number) - (b as number);
  }

  let sortedDirs = $derived.by(() =>
    [...dataDirs]
      .filter((d) => !search || d.name.toLowerCase().includes(search))
      .sort((a, b) => cmp(sortValue(a, sortKey === 'name' ? 'name' : sortKey), sortValue(b, sortKey === 'name' ? 'name' : sortKey)) * (sortKey === 'name' ? sortDir : 1)),
  );
  let sortedFiles = $derived.by(() =>
    [...dataFiles]
      .filter((f) => !!f)
      .filter((f: any) => !search || String(f.name ?? f.filename).toLowerCase().includes(search))
      .sort((a, b) => cmp(sortValue(a, sortKey), sortValue(b, sortKey)) * sortDir),
  );

  // ---------------- column drag reorder (gcode) ----------------
  let colDrag = $state<string | null>(null);
  function onColDragStart(key: string, e: DragEvent): void {
    colDrag = key; e.dataTransfer?.setData('text/plain', key);
  }
  function onColDragOver(key: string, e: DragEvent): void {
    e.preventDefault();
    if (!colDrag || colDrag === key || mode === 'simple') return;
    const order = visibleKeys;
    const from = order.indexOf(colDrag), to = order.indexOf(key);
    if (from < 0 || to < 0) return;
    const next = [...order]; next.splice(from,1); next.splice(to,0,colDrag);
    setVisibleColumns(api, scope, next);
  }

  // ---------------- rows / menu ----------------
  let crumbs = $derived(dataPath ? dataPath.split('/') : []);
  function goParent(): void {
    if (menu) { menu = null; return; }
    if (!dataPath) return;
    const segs = dataPath.split('/');
    segs.pop();
    source.navigate(segs.join('/'));
  }

  function crumbNav(p: string): void {
    if (menu) { menu = null; return; }
    source.navigate(p);
  }

  function refOf(name: string, isDir: boolean): FileRef {
    return { root, path: dataPath ? `${dataPath}/${name}` : name, isDir };
  }

  let menu = $state<{ x:number; y:number; ref:FileRef; isDir:boolean } | null>(null);

  // ---------------- extension points (see extension-points.ts) ----------------
  // Re-read on any registry change (plugin enabled/disabled, availability, conflict resolution).
  // Without the tick, an `available()` that resolves after the menu opened would never show its item.
  let extTick = $state(0);
  $effect(() => api.extensions.onChange(() => extTick++));

  /** Point params are strings only (MpuParams); they also reach the extension's `available(api, params)`. */
  function fileParams(ref: FileRef): MpuParams {
    return { root: ref.root, path: ref.path, isDir: String(ref.isDir) };
  }

  /** Extension actions of `file-actions`, appended after the page's own menu items. */
  function extMenuItems(ref: FileRef): ContextMenuItem[] {
    return api.extensions
      .list(FILE_TABLE_POINT_IDS.actions, fileParams(ref))
      .map((a) => ({ id: `ext:${a.ref}`, label: a.title, ...(a.icon ? { icon: a.icon } : {}) }));
  }

  let items = $derived.by<ContextMenuItem[]>(() => {
    if (!menu) return [];
    void extTick;
    const backup = configBackupRef(menu.ref);
    const hasBackup = backup && !menu.isDir && dataFiles.some((f) => f.name === backup.path.split('/').pop());
    const safetyItems: ContextMenuItem[] = hasBackup
      ? [{ id: 'compare-backup', label: i18n.t('config.compareBackup'), icon: 'file' },
         { id: 'restore-backup', label: i18n.t('config.restoreBackup'), icon: 'refresh' }]
      : [];
    return [...(menuItems?.(menu.ref, menu.isDir) ?? []), ...safetyItems, ...extMenuItems(menu.ref)];
  });

  let renameRef = $state<FileRef | null>(null);
  let renameOpen = $state(false);
  let deleteRef = $state<FileRef | null>(null);
  let deleteOpen = $state(false);
  let editorRef = $state<FileRef | null>(null);
  let editorOpen = $state(false);
  let editorLoading = $state(false);
  let editorContent = $state('');
  let saveBusy = $state(false);
  let failureRef = $state<FileRef | null>(null);
  let failurePrinterId = $state('');
  let restartStatus = $state('');
  let restartStatusPrinterId = $state('');
  let backupDialogRef = $state<FileRef | null>(null);
  let backupDialogPrinterId = $state('');
  let backupDialogOpen = $state(false);
  let backupDiff = $state<ConfigDiffLine[]>([]);
  let backupRestored = $state(false);
  let backupDialogNotice = $state('');

  /** Read both files from Moonraker so comparison still works after a page reload. */
  async function openBackupDialog(ref: FileRef): Promise<void> {
    const backup = configBackupRef(ref);
    if (!backup) return;
    const printerId = api.printer.id;
    try {
      const target = api.moonrakerFor(printerId);
      const [previous, current] = await Promise.all([
        ops.readText(backup, target), ops.readText(ref, target),
      ]);
      if (api.printer.id !== printerId) return;
      backupDiff = diffConfigLines(previous, current);
      backupDialogRef = ref;
      backupDialogPrinterId = printerId;
      backupRestored = false;
      backupDialogNotice = '';
      backupDialogOpen = true;
    } catch (e) {
      setNotice(api, scope, errText(e));
    }
  }

  /** A direct restore is available from the error banner and the file menu. */
  async function restoreBackup(ref: FileRef | null = backupDialogRef): Promise<void> {
    if (!ref || saveBusy) return;
    if (backupDialogOpen && backupDialogPrinterId !== api.printer.id) return;
    const printerId = api.printer.id;
    saveBusy = true;
    try {
      await ops.restoreConfigBackup(ref, api.moonrakerFor(printerId));
      if (api.printer.id !== printerId) return;
      backupDialogRef = ref;
      backupDialogPrinterId = printerId;
      backupDiff = [];
      backupRestored = true;
      backupDialogNotice = '';
      backupDialogOpen = true;
      failureRef = null;
      void source.refresh();
    } catch (e) {
      setNotice(api, scope, errText(e));
    } finally {
      saveBusy = false;
    }
  }

  /** The restored bytes are already on disk; restarting must not replace their backup. */
  async function restartRestored(): Promise<void> {
    const ref = backupDialogRef;
    if (!ref || saveBusy || backupDialogPrinterId !== api.printer.id) return;
    const printerId = api.printer.id;
    saveBusy = true;
    try {
      const result = await restartConfig(ref, printerId, true);
      if (result !== 'blocked') backupDialogOpen = false;
    } catch (e) {
      backupDialogNotice = errText(e);
    } finally {
      saveBusy = false;
    }
  }
  let editorReadonly = $state(false); // пригодится в шаге 3
  let editorCanRestart = $derived(
    editorRef ? /\.(conf|cfg)$/i.test(editorRef.path.split('/').pop() ?? '') : false,
  );
  let editorLang = $state<'klipper' | 'plain' >('plain');

  let viewerRef = $state<FileRef | null>(null);
  let viewerOpen = $state(false);
  let viewerSrc = $state('');
  let viewerSeq = $state(0);

  /** Обрыв соединения при рестарте — норма; отказ гарда или ошибка Moonraker — показываем. */
  function reportRestartError(e: unknown): void {
    if ((e as { rejection?: unknown } | null)?.rejection || (e as { name?: string } | null)?.name === 'MoonrakerRequestError') {
      setNotice(api, scope, errText(e));
    }
  }

  /** A restart is verified against the same printer and file used by the save. */
  async function restartConfig(ref: FileRef, printerId: string, protectedSave: boolean): Promise<'blocked' | void> {
    const target = api.moonrakerFor(printerId);
    const kind = ref.root === 'config' && /^moonraker\.conf$/i.test(ref.path) ? 'moonraker' : 'klipper';
    const restart = () => kind === 'moonraker'
      ? target.request('machine.services.restart', { service: 'moonraker' })
      : target.request('printer.firmware_restart', {});
    if (!protectedSave) {
      await restart().catch(reportRestartError);
      return;
    }
    // Recovery may run while Klipper is in error; only an active print blocks restart.
    const info = await target.request<{ state?: string }>('printer.info');
    if (info.state === 'ready') {
      const status = await target.request<{ status?: { print_stats?: { state?: string } } }>(
        'printer.objects.query', { objects: { print_stats: ['state'] } },
      );
      const printState = status.status?.print_stats?.state;
      if (printState === 'printing' || printState === 'paused') {
        failureRef = ref;
        failurePrinterId = printerId;
        setNotice(api, scope, i18n.t('config.restartDuringPrint'));
        backupDialogNotice = i18n.t('config.restartDuringPrint');
        return 'blocked';
      }
    }
    restartStatus = i18n.t('config.restartChecking');
    restartStatusPrinterId = printerId;
    const outcome = await checkConfigRestart(target, kind, restart);
    if (outcome === 'ready') {
      const backup = configBackupRef(ref);
      if (backup) {
        try {
          await target.request('server.files.delete_file', { path: fullPath(backup) });
          failureRef = null;
          restartStatus = i18n.t('config.restartReady');
          void source.refresh();
        } catch (e) {
          restartStatus = '';
          setNotice(api, scope, i18n.t('config.backupDeleteError', { error: errText(e) }));
        }
      }
    } else {
      restartStatus = '';
      failureRef = ref;
      failurePrinterId = printerId;
      const key = outcome === 'error' ? 'config.restartError'
        : outcome === 'rejected' ? 'config.restartRejected' : 'config.restartTimeout';
      setNotice(api, scope, i18n.t(key));
      if (kind === 'moonraker' && outcome === 'timeout') {
        const backup = configBackupRef(ref)!;
        setNotice(api, scope, i18n.t('config.moonrakerRecovery', {
          path: backup.path, target: ref.path,
        }));
      }
    }
  }

  /** Both save buttons share the same backup-first path for protected config files. */
  async function saveAndRestart(text: string): Promise<boolean> {
    if (!editorRef || saveBusy) return false;
    const ref = editorRef;
    const printerId = api.printer.id;
    const protectedSave = configBackupRef(ref) !== null;
    saveBusy = true;
    restartStatus = '';
    try {
      if (protectedSave) await ops.saveConfigText(ref, text, api.moonrakerFor(printerId));
      else await ops.saveText(ref, text);
      editorContent = text;
      editorOpen = false;
      failureRef = null;
      setNotice(api, scope, null);
      void source.refresh();
      await restartConfig(ref, printerId, protectedSave);
      return true;
    } catch (e) {
      setNotice(api, scope, errText(e));
      return false;
    } finally {
      saveBusy = false;
    }
  }

  function onRowLeft(e: MouseEvent, name: string, isDir: boolean): void {
    e.stopPropagation();
    if (!menuEnabled) return;
    // открытое меню: первый ЛКМ только закрывает его
    if (menu) {
        menu = null;
        return;
    }

    if (isDir) {
        source.navigate(dataPath ? `${dataPath}/${name}` : name);
        return;
    }

    const cap = fileCap(api, name, root);
    if (cap.canOpen && cap.mode === 'edit') {
      menu = null;
      void openEditor(refOf(name, false));
      return;
    }
    if (cap.canOpen && cap.mode === 'view') {
      menu = null;
      openViewer(refOf(name, false));
      return;
    }

    menu = { x: e.clientX, y: e.clientY, ref: refOf(name, false), isDir: false };
  }

  function onRowRight(e: MouseEvent, name: string, isDir: boolean): void {
    e.preventDefault();
    e.stopPropagation();
    if (!menuEnabled) return;
    menu = { x: e.clientX, y: e.clientY, ref: refOf(name, isDir), isDir };
  }

  let editorSeq = $state(0);
  let editorRestartKind = $derived<'klipper' | 'moonraker'>(
    editorRef?.root === 'config' && /^moonraker\.conf$/i.test(editorRef.path) ? 'moonraker' : 'klipper',
  );
  async function openEditor(ref: FileRef): Promise<void> {
    // A backup remains readable but cannot be edited through the ordinary file menu.
    editorReadonly = fileCap(api, ref.path.split('/').pop() ?? '', ref.root).readonly ||
      (ref.root === 'config' && /\.(cfg|conf)\.bak$/i.test(ref.path));
    const name = ref.path.split('/').pop() ?? '';
    editorLang = /\.(conf|cfg)$/i.test(name)
        ? 'klipper'
        : 'plain';
    editorRef = ref;
    editorSeq++;
    editorByExt = false;
    editorOpen = true;
    editorLoading = true;
    editorContent = '';
    try {
        const raw = await ops.readText(ref);
        editorContent = raw.replace(/\r\n?/g, '\n'); // CRLF/CR → LF до попадания в редактор
    } catch (e) {
        editorOpen = false;
        setNotice(api, scope, errText(e));
    } finally {
        editorLoading = false;
    }
  }

  function openViewer(ref: FileRef): void {
    // Moonraker отдаёт бинарщину прямым HTTP: GET /server/files/<root>/<path>
    // (сегменты кодируются, токен авторизации — в query: <img> заголовки не шлёт)
    viewerSrc = ops.viewUrl(ref);
    viewerRef = ref;
    viewerSeq++;
    viewerByExt = false;
    viewerOpen = true;
  }

  // ---------------- file-editor / file-viewer replacement ----------------
  // The file is still read for the built-in editor even when an extension replaces it: the
  // availability of a contribution is async, and the built-in dialog must be ready to take
  // over (an empty buffer saved over a config would be destructive).
  // `*ByExt` latches once the extension has taken a session over, so the built-in dialog
  // never pops up next to a running extension when its availability is re-evaluated.
  let editorByExt = $state(false);
  let viewerByExt = $state(false);

  let editorWanted = $derived.by(() => {
    void extTick;
    if (!editorOpen || !editorRef) return false;
    return !api.extensions.resolve(FILE_TABLE_POINT_IDS.editor, {
      ...fileParams(editorRef),
      readonly: String(editorReadonly),
    }).original;
  });
  let viewerWanted = $derived.by(() => {
    void extTick;
    if (!viewerOpen || !viewerRef) return false;
    return !api.extensions.resolve(FILE_TABLE_POINT_IDS.viewer, fileParams(viewerRef)).original;
  });
  $effect(() => { if (editorWanted) editorByExt = true; });
  $effect(() => { if (viewerWanted) viewerByExt = true; });

  let editorExtParams = $derived<MpuParams>(
    editorRef ? { ...fileParams(editorRef), readonly: String(editorReadonly) } : {},
  );
  let viewerExtParams = $derived<MpuParams>(viewerRef ? fileParams(viewerRef) : {});

  // A replacing extension owns its dialog and tells us when the session is over with a bubbling
  // composed event (like the banner's `mpu:banner-expand`), because it cannot reach our state.
  let cardEl = $state<HTMLElement | null>(null);
  $effect(() => {
    const el = cardEl;
    if (!el) return;
    const closeEditor = () => { editorOpen = false; editorByExt = false; };
    const closeViewer = () => { viewerOpen = false; viewerByExt = false; };
    el.addEventListener('mpu:editor-close', closeEditor);
    el.addEventListener('mpu:viewer-close', closeViewer);
    return () => {
      el.removeEventListener('mpu:editor-close', closeEditor);
      el.removeEventListener('mpu:viewer-close', closeViewer);
    };
  });

  async function handleMenuSelect(id: string): Promise<void> {
    if (!menu) return;
    const ref = menu.ref;
    try {
      if (id === 'edit') await openEditor(ref);
      else if (id === 'zip') await ops.createZip(ref);
      else if (id === 'download') ops.download(ref);
      else if (id === 'rename') { renameRef = ref; renameOpen = true; }
      else if (id === 'copy') await ops.copy(ref);
      else if (id === 'compare-backup') await openBackupDialog(ref);
      else if (id === 'restore-backup') await restoreBackup(ref);
      else if (id === 'delete') { deleteRef = ref; deleteOpen = true; }
      else if (id.startsWith('ext:')) {
        // `file-actions` contribution: the extension gets the file it was invoked on (typed context).
        await api.extensions.invoke(id.slice('ext:'.length), { root: ref.root, path: ref.path, isDir: ref.isDir });
      }
      else await onAction?.(id, ref);
    } catch (e) {
      setNotice(api, scope, errText(e));
    }
  }

  // ---------------- gcode cell render ----------------
  function thumbnailUrl(row: FileRow | null | undefined): string | null {
    if (!row) return null;

    const thumbs: any[] = Array.isArray(row.thumbnails) ? row.thumbnails : [];
    const list = thumbs.filter((t) => t && typeof t.relative_path === 'string');
    if (list.length === 0) return null;

    const best = [...list].sort(
        (a, b) => Math.abs((a.width ?? 0) - 64) - Math.abs((b.width ?? 0) - 64),
    )[0];
    if (!best) return null;

    const fp = dataPath ? `${dataPath}/${row.name}` : row.name;
    const dir = fp.includes('/') ? fp.slice(0, fp.lastIndexOf('/')) : '';
    const rel = dir ? `${dir}/${best.relative_path}` : best.relative_path;

    return `${api.moonraker().httpBaseUrl}/server/files/gcodes/${rel
        .split('/')
        .map(encodeURIComponent)
        .join('/')}`;
  }
  function cellText(f: any, key: string): string {
    const r = f.raw ?? f;
    switch (key) {
      case 'size': return formatSize(f.size);
      case 'modified': return formatDate(f.modified);
      case 'slicer': return r.slicer ? `${r.slicer}${r.slicer_version ? ' '+r.slicer_version : ''}` : '—';
      case 'layer_height': case 'first_layer_height': case 'object_height': case 'nozzle_diameter':
        return r[key] != null ? `${r[key]} mm` : '—';
      case 'layer_count': return r.layer_count != null ? String(r.layer_count) : '—';
      case 'filament_total': return r.filament_total != null && typeof r.filament_total==='number' ? `${(r.filament_total/1000).toFixed(2)} m` : '—';
      case 'filament_weight_total': return r.filament_weight_total != null ? `${r.filament_weight_total.toFixed(0)} g` : '—';
      case 'estimated_time': { const s=r.estimated_time; if(!s) return '—'; const h=Math.floor(s/3600),m=Math.floor((s%3600)/60); return h?`${h}h ${m}m`:`${m}m`; }
      case 'first_layer_extruder_temp': case 'first_layer_bed_temp': case 'chamber_temp':
        return r[key] != null ? `${r[key]}°C` : '—';
      case 'last_print': return r.print_start_time ? formatDate(r.print_start_time) : '—';
      default: return '—';
    }
  }
  function statusClass(s: string | null): string {
    if (!s) return 'st-none';
    return `st-${s.toLowerCase().replace(/[^a-z0-9_]/g, '-')}`;
  }

  /** Локализованный статус; неизвестный (нет ключа ft.status.*) показываем как есть. */
  function statusLabel(s: string | null): string {
    if (!s) return '—';
    const key = `ft.status.${s.toLowerCase()}`;
    const label = i18n.t(key);
    return label === key ? s : label;
  }
  function hideBrokenImage(e: Event): void { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden'; }

  /** Confirm the editor buffer only after the backup and upload both succeeded. */
  async function handleSave(t: string): Promise<boolean> {
    if (!editorRef || saveBusy) return false;
    const ref = editorRef;
    const printerId = api.printer.id;
    saveBusy = true;
    restartStatus = '';
    try {
      if (configBackupRef(ref)) await ops.saveConfigText(ref, t, api.moonrakerFor(printerId));
      else await ops.saveText(ref, t);
      editorContent = t; // Confirm the editor buffer only after both backup and upload succeed.
      failureRef = null;
      setNotice(api, scope, null);
      void source.refresh();
      return true;
    } catch (e) {
      setNotice(api, scope, errText(e));
      return false;
    } finally {
      saveBusy = false;
    }
  }
</script>

<div class="ft-card" bind:this={cardEl}>
  {#if showHeader}
    <div class="page-header">
      <span class="page-title">{title}</span>
      <div class="actions">
        <FileTableHeaderActions {scope} {mode} {showAdd} {root} {menuEnabled} {onThreeMF} />
      </div>
    </div>
  {/if}

  {#if headerExtra}
    {@render headerExtra()}
  {/if}

  {#if mode !== 'history'}
    <div class="ft-toolbar">
      <nav class="crumbs">
        <button class="crumb" onclick={() => crumbNav('')}>/</button>
          {#each crumbs as seg, i (`${seg}-${i}`)}
          <button class="crumb" onclick={() => crumbNav(crumbs.slice(0, i + 1).join('/'))}>
              <bdi>{seg}</bdi>{i < crumbs.length - 1 ? '/' : ''}
          </button>
          {/each}
      </nav>
    </div>
  {/if}

  {#if notice}
    <p class="notice">{notice}</p>
  {/if}
  {#if restartStatus && api.printer.id === restartStatusPrinterId}
    <p class="restart-status" role="status">{restartStatus}</p>
  {/if}
  {#if failureRef && root === 'config' && api.printer.id === failurePrinterId}
    <button class="btn" onclick={() => void restoreBackup(failureRef!)}>{i18n.t('config.restoreBackup')}</button>
  {/if}

  {#if sourceError}
    <div class="ft-state">
      <Icon name="warning" size={18} />
      <span class="ft-state-text">{i18n.t('ft.error')}</span>
      <span class="ft-state-hint">{sourceError}</span>
      <button class="btn" onclick={() => void source.refresh()}>{i18n.t('ft.retry')}</button>
    </div>
  {:else if loading && dataFiles.length === 0 && dataDirs.length === 0}
    <div class="ft-state">
      <Loader text={i18n.t('ft.loading')} />
    </div>
  {:else}
    <div class="ft-scroll">
      <table class="ft-table">
        <thead>
          <tr>
            {#each cols as col (col.key)}
              <th
                draggable={mode !== 'simple'}
                ondragstart={(e) => onColDragStart(col.key, e)}
                ondragover={(e) => onColDragOver(col.key, e)}
                ondrop={(e) => e.preventDefault()}
                ondragend={() => (colDrag = null)}
              >
                <button
                  class="th-btn"
                  class:active={sortKey === col.key}
                  onclick={() => toggleSort(col.key)}
                >
                  <span class="th-label">{i18n.t(col.labelKey)}</span>
                  <span class="sort-arrow" class:visible={sortKey === col.key}>
                      <Icon name={sortKey === col.key && sortDir === 1 ? 'arrow-up' : 'arrow-down'} size={12} />
                  </span>
                </button>
              </th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#if dataPath}
            <tr class="row-dir" onclick={goParent}>
              <td colspan={COLSPAN} class="td-dir"><span class="cell"><span class="file-ico dir"><Icon name="folder" size={15} /></span>..</span></td>
            </tr>
          {/if}

          {#each sortedDirs as d (d.name)}
            <tr class="row-dir" class:inert={!menuEnabled} onclick={(e) => onRowLeft(e, d.name, true)} oncontextmenu={(e) => onRowRight(e, d.name, true)}>
              <td class="td-name"><span class="cell"><span class="file-ico dir"><Icon name="folder" size={15} /></span><bdi>{d.name}</bdi></span></td>
              {#if mode === 'simple'}
                <td>{formatDate(d.modified)}</td>
                <td>{formatSize(d.size)}</td>
              {:else}
                {#each cols.slice(1) as col (col.key)}
                  <td>—</td>
                {/each}
              {/if}
            </tr>
          {/each}

          {#each sortedFiles as f (mode === 'history' ? (f.raw?.job_id ?? f.name ?? f.filename) : (f.name ?? f.filename))}
            {@const fname = f.name ?? f.filename}
            <tr class="row-file" class:inert={!menuEnabled} onclick={(e) => onRowLeft(e, fname, false)} oncontextmenu={(e) => onRowRight(e, fname, false)}>
              {#if mode === 'simple'}
                <td class="td-name"><span class="cell"><span class="file-ico"><Icon name="file" size={15} /></span><bdi>{fname}</bdi></span></td>
                <td>{formatDate(f.modified)}</td>
                <td>{formatSize(f.size)}</td>
              {:else}
                {#each cols as col (col.key)}
                  {#if col.key === 'name'}
                    <td class="td-name"><span class="cell"><span class="file-ico"><Icon name="file" size={15} /></span><bdi>{f.name}</bdi></span></td>
                  {:else if col.key === 'thumbnail'}
                    {@const url = thumbnailUrl(f)}
                      <td class="td-thumb">
                        {#if url}
                          <img class="thumb" src={url} alt="" loading="lazy" onerror={hideBrokenImage} />
                        {:else}—{/if}
                      </td>
                  {:else if col.key === 'status'}
                    {@const st = source.statusOf?.(f.name, f) ?? null}
                    <td><span class="st {statusClass(st)}">{statusLabel(st)}</span></td>
                  {:else if col.key === 'filament_name' || col.key === 'filament_type'}
                    {@const arr = asStrings((f.raw ?? f)[col.key])}
                    <td>{#if arr.length}<span class="chips">{#each arr as v, i (`${col.key}-${i}-${v}`)}<span class="chip">{v}</span>{/each}</span>{:else}—{/if}</td>
                  {:else if col.key === 'filament_colors' || col.key === 'extruder_colors'}
                    {@const arr = asStrings((f.raw ?? f)[col.key])}
                    <td>{#if arr.length}<span class="dots">{#each arr as c, i (`${col.key}-${i}`)}<span class="dot" style="background: {safeColor(c)}"></span>{/each}</span>{:else}—{/if}</td>
                  {:else if col.key === 'filament_weight' || col.key === 'filament_length'}
                    {@const m = f.raw ?? f}
                    {@const arr = asNumbers(col.key === 'filament_weight'
                      ? m.filament_weight
                      : m.filament_length ?? (Array.isArray(m.filament_total) ? m.filament_total : undefined))}
                    <td>{#if arr.length}<span class="chips">{#each arr as n, i (`w-${i}`)}<span class="chip">{col.key==='filament_weight'?`${n.toFixed(2)} g`:`${(n/1000).toFixed(2)} m`}</span>{/each}</span>{:else}—{/if}</td>
                  {:else if col.key === 'filament_total'}
                    {@const arr = asNumbers((f.raw ?? f).filament_total)}
                    <td>{#if arr.length>1}<span class="chips">{#each arr as n, i (`t-${i}`)}<span class="chip">{(n/1000).toFixed(2)} m</span>{/each}</span>{:else}{cellText(f, col.key)}{/if}</td>
                  {:else}
                    <td>{cellText(f, col.key)}</td>
                  {/if}
                {/each}
              {/if}
            </tr>
          {:else}
            {#if sortedDirs.length === 0}
              <tr><td colspan={COLSPAN} class="empty">{i18n.t('ft.empty')}</td></tr>
            {/if}
          {/each}
        </tbody>
      </table>
    </div>
  {/if}

  {#if menu}
    <ContextMenu x={menu.x} y={menu.y} items={items} onSelect={handleMenuSelect} onClose={() => (menu = null)} />
  {/if}

  <input hidden type="file" multiple />

  {#if root === 'config'}
    <ConfigBackupDialog
      open={backupDialogOpen}
      name={backupDialogRef?.path.split('/').pop() ?? ''}
      lines={backupDiff}
      busy={saveBusy}
      restored={backupRestored}
      notice={backupDialogNotice}
      onRestore={() => void restoreBackup()}
      onRestart={() => void restartRestored()}
      onClose={() => (backupDialogOpen = false)}
    />
  {/if}

  <PromptDialog 
    open={renameOpen} 
    title={i18n.t('ft.renameTitle')} 
    initial={renameRef?.path.split('/').pop() ?? ''} 
    confirmLabel={i18n.t('ft.rename')} 
    onSubmit={(v)=>{ if(renameRef) ops.rename(renameRef,v).catch((e) => setNotice(api, scope, errText(e))); }} 
    onClose={() => (renameOpen = false)} 
  />
  <ConfirmDialog 
    open={deleteOpen} 
    title={i18n.t('ft.deleteTitle')} 
    message={i18n.t('ft.deleteMessage', { name: deleteRef?.path.split('/').pop() ?? '' })} 
    confirmLabel={i18n.t('ft.delete')} 
    danger 
    onConfirm={()=>{ if(deleteRef) ops.remove(deleteRef).catch((e) => setNotice(api, scope, errText(e))); }} 
    onClose={() => (deleteOpen = false)} 
  />
  <!-- file-editor / file-viewer (replacement): a contribution takes the whole dialog and is mounted
       only for the duration of a session, not while the table is merely shown. Its UI must live in
       the top layer (<dialog>.showModal()): this card clips in-flow content. -->
  {#if editorByExt}
    <ExtensionPoint point={FILE_TABLE_POINT_IDS.editor} params={editorExtParams} />
  {:else}
    {#key `${editorRef?.path ?? ''}#${editorSeq}`}
      <TextEditorDialog
          open={editorOpen}
          title={editorRef?.path.split('/').pop() ?? ''}
          loading={editorLoading}
          saving={saveBusy}
          content={editorContent}
          readonly={editorReadonly}
          canRestart={editorCanRestart}
          restartKind={editorRestartKind}
          lang={editorLang}
          onSave={handleSave}
          onSaveRestart={saveAndRestart}
          onClose={() => (editorOpen = false)}
      />
    {/key}
  {/if}
  {#if viewerByExt}
    <ExtensionPoint point={FILE_TABLE_POINT_IDS.viewer} params={viewerExtParams} />
  {:else}
    {#key `${viewerRef?.path ?? ''}#${viewerSeq}`}
      <ImageViewerDialog
        open={viewerOpen}
        title={viewerRef?.path.split('/').pop() ?? ''}
        src={viewerSrc}
        onDownload={viewerRef ? () => { if (viewerRef) ops.download(viewerRef); } : null}
        onClose={() => (viewerOpen = false)}
      />
    {/key}
  {/if}
</div>

<style>
    .ft-card { 
        display:flex;
        flex-direction:column;
        height:100%;
        min-height:0;
        background:var(--bg-surface);
        border:1px solid var(--border-color);
        border-radius:var(--radius-md);
        box-shadow:var(--shadow-sm);
        overflow:hidden;
    }
    .ft-card .page-header { 
        margin-bottom:0;
    }
    .ft-toolbar { 
        display:flex;
        align-items:center;
        gap:var(--space-sm);
        padding:var(--space-sm) var(--space-md);
        border-bottom:1px solid var(--border-color);
        flex-shrink:0;
    }
    /* Путь — LTR-фрагмент даже в RTL-интерфейсе (слэши не должны «переворачиваться») */
    .crumbs { 
        direction:ltr;
        display:flex;
        align-items:center;
        gap:var(--space-xs);
        flex-wrap:wrap;
        min-height:28px;
    }
    .crumb { 
        border:none;
        background:transparent;
        color:var(--accent);
        font-family:monospace;
        font-size:var(--font-size-sm);
        cursor:pointer;
        padding:2px var(--space-xs);
        border-radius:var(--radius-sm);
    }
    .notice { 
        color:var(--danger);
        font-size:var(--font-size-sm);
        padding:0 var(--space-md);
        overflow-wrap:anywhere;
    }
    .restart-status {
        color: var(--text-secondary);
        font-size: var(--font-size-sm);
        padding-inline: var(--space-md);
        overflow-wrap: anywhere;
    }
    .ft-scroll { 
        flex:1;
        min-height:0;
        overflow:auto;
    }
    .ft-table { 
        width:100%;
        border-collapse:collapse;
        font-size:var(--font-size-md);
    }
    .ft-table th { 
        padding:0;
        border-bottom:1px solid var(--border-color);
        position:sticky;
        top:0;
        background:var(--bg-surface);
        text-align:start;
    }
    .th-btn {
        display: flex;
        align-items: center;
        gap: var(--space-xs);
        width: 100%;
        padding: var(--space-sm) var(--space-md);
        border: none;
        background: transparent;
        cursor: pointer;
        color: var(--text-muted);
        font-size: var(--font-size-sm);
        text-transform: uppercase;
        letter-spacing: 0.04em;
        text-align: start;
        min-width: 0;
    }

    .th-label {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .th-btn.active { 
        color:var(--accent);
    }
    .ft-table td { 
        padding:var(--space-sm) var(--space-md);
        border-bottom:1px solid var(--border-color);
        vertical-align:middle;
    }
    .row-dir,.row-file { 
        cursor:pointer;
    }
    .row-dir:hover td,.row-file:hover td {
        background:var(--bg-surface-hover);
    }
    /* menuEnabled=false (History): rows do nothing on click, so they must not look clickable —
       no pointer cursor and no hover highlight. */
    .row-dir.inert,.row-file.inert {
        cursor:default;
    }
    .row-dir.inert:hover td,.row-file.inert:hover td {
        background:transparent;
    }
    .td-name .cell,.td-dir .cell { 
        display:flex;
        align-items:center;
        gap:var(--space-sm);
    }
    .td-name .cell { 
        font-family:monospace;
        word-break:keep-all;
    }
    .file-ico { 
        display:flex;
        color:var(--text-muted);
        flex-shrink:0;
    }
    .file-ico.dir { 
        color:var(--accent);
    }
    .empty { 
        color:var(--text-muted);
        text-align:center;
        padding:var(--space-lg);
    }
    .chips { 
        display:inline-flex;
        flex-wrap:wrap;
        gap:4px;
        vertical-align:middle;
    }
    .chip { 
        padding:1px 8px;
        border-radius:999px;
        background:var(--bg-surface-hover-no-override);
        border:1px solid var(--border-color);
        font-size:var(--font-size-sm);
        color:var(--text-secondary);
        white-space:nowrap;
    }
    .dots { 
        display:inline-flex;
        align-items:center;
        gap:4px;
        vertical-align:middle;
    }
    .dot { 
        width:14px;
        height:14px;
        border-radius:50%;
        border:1px solid var(--border-color);
        display:inline-block;
    }
    .td-thumb { 
        width:56px;
    }
    .thumb { 
        display:block;
        width:48px;
        height:48px;
        object-fit:cover;
        border-radius:var(--radius-sm);
        border:1px solid var(--border-color);
        background:var(--bg-surface-hover-no-override);
    }

    /* статус задания / файла */
    .st {
        display:inline-block;
        padding:1px 8px;
        border-radius:999px;
        border:1px solid var(--border-color);
        background:var(--bg-surface-hover-no-override);
        color:var(--text-secondary);
        font-size:var(--font-size-sm);
        white-space:nowrap;
    }
    .st-none { border-color:transparent; background:transparent; color:var(--text-muted); }
    .st-completed,.st-complete {
        color:var(--success);
        border-color:color-mix(in srgb, var(--success) 45%, var(--border-color));
    }
    .st-printing,.st-in_progress {
        color:var(--accent);
        border-color:color-mix(in srgb, var(--accent) 45%, var(--border-color));
    }
    .st-paused,.st-cancelled,.st-interrupted {
        color:var(--warning);
        border-color:color-mix(in srgb, var(--warning) 45%, var(--border-color));
    }
    .st-error,.st-klippy_shutdown,.st-klippy_disconnect,.st-server_exit {
        color:var(--danger);
        border-color:color-mix(in srgb, var(--danger) 45%, var(--border-color));
    }

    .sort-arrow {
        display: inline-flex;
        align-items: center;
        visibility: hidden;
        flex-shrink: 0;
        margin-inline-start: auto;
    }
    .sort-arrow.visible { visibility: visible; }

    .th-btn :global(svg) { flex-shrink: 0; }

    .ft-state {
      display: flex; flex-direction: column; align-items: center; gap: var(--space-sm);
      padding: var(--space-xl); color: var(--text-muted); text-align: center;
    }
    .ft-state-hint { font-size: var(--font-size-sm); color: var(--text-muted); }
</style>
