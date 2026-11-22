<script lang="ts">
  import { tick, untrack } from 'svelte';
  import type { EditorView } from '@codemirror/view';
  import type { ExtensionRef } from '../../../plugin-sdk/src/types';
  import { usePluginApi } from '../../../plugin-sdk/src/svelte/index';

  import { useKlippyState } from '../klippy-state/use-klippy-state.svelte.ts';
  import type { KlippyState } from '../klippy-state/use-klippy-state.svelte.ts';
  import { editorUi, registerEditorHotkeys, type EditorHotkeyAction } from './editor-state.svelte.ts';

  import Icon from '../icons/Icon.svelte';
  import Loader from '../loader/Loader.svelte';
  import ColorPickerMenu from '../color-picker/ColorPickerMenu.svelte';
  import { highlightKlipperLines, highlightPlainLines, toRenderLines } from './highlight';
  import {
    TOKEN_KEYS,
    effectiveColor,
    toStyle,
    type ThemeName,
    type TokKey,
  } from './highlight-colors';
  import {
    getOverrides,
    reloadColors,
    resetTheme,
    setColor,
  } from './highlight-colors.svelte.ts';
  import {
    DEFAULT_CAN_INTERFACE,
    DEVICE_KINDS,
    classifyError,
    isValidCanInterface,
    loadDevices,
    type DeviceCard,
    type DeviceErrorStatus,
    type DeviceKind,
  } from './peripherals';
  import { copyText } from './clipboard';
  import { replaceEditorRange } from './editor-replacement';
  import { useNarrow } from '../responsive/use-narrow.svelte.ts';
  import ConfigHelpPopover from './ConfigHelpPopover.svelte';
  import ConfigCompareView from './ConfigCompareView.svelte';
  import ConfigCodeMirror, { type EditorSnapshot, type PeekSpec } from './ConfigCodeMirror.svelte';
  import { macroCallAt, macroSectionEdit, scanMacroDefinitions, type MacroDefinition } from './macro-index';
  import { createMacroBuilderSession } from './macro-builder-session';
  import { configBackupHunkEdit, configCurrentLineMarks, configDiffHunks, type ConfigDiffHunk } from '../file-table/config-diff';
  import {
    pointToCell,
    resolveSection,
    sectionAbove,
    sectionAtCell,
    sectionInsideAt,
    type HelpView,
  } from './config-reference';
  import { parseBlocks } from './mini-markdown';
  import { classifyReferenceError, loadReference } from './reference-store';
  import { HELP_WIDTH, type Anchor } from './help-position';
  import { caretLineCol } from './caret';

  import {
    collectAllWords,
    collectJinjaVars,
    getCompletionContext,
    getSuggestions,
    type Suggestion,
  } from './autocomplete';
  import { mergeLocalMacros } from '../gcode-hints/catalog';
  import { attachHints, getCatalog, getObjects } from '../gcode-hints/gcode-hints-store.svelte.ts';
  import { macroParamNamesAt, scanLocalMacros } from '../gcode-hints/local-macros';
  import { literalType, mergeObjectIndex, scanSectionNames } from '../gcode-hints/object-names';

  let {
    open,
    title,
    loading = false,
    saving = false,
    content,
    filePath,
    activeTabId,
    tabs = [],
    jumpLine = 0,
    macroNames = [],
    onBufferChange,
    editorSnapshot,
    onEditorSnapshot,
    onSelectTab,
    onCloseTab,
    onLookupMacro,
    onMacroSource,
    onPeekEdit,
    onPeekSave,
    onMacroNavigate,
    onSaveAll,
    readonly = false,
    canRestart = false,
    restartRequired = true,
    restartLabel,
    hasPendingSave = false,
    restartKind = 'klipper',
    lang = 'plain',
    compareInitially = false,
    loadBackup,
    onSave,
    onSaveRestart,
    onRequestClose,
    onMinimize,
    embedded = false,
    onRegisterBeforeLeave,
    onRegisterSettings,
    onSettingsOpenChange,
    onClose,
  }: {
    open: boolean;
    title: string;
    loading?: boolean;
    saving?: boolean;
    content: string;
    filePath?: string;
    activeTabId?: string;
    tabs?: Array<{ id?: string; path: string; dirty: boolean }>;
    jumpLine?: number;
    macroNames?: string[];
    onBufferChange?: (text: string) => void;
    editorSnapshot?: EditorSnapshot;
    onEditorSnapshot?: (path: string, state: EditorSnapshot) => void;
    onSelectTab?: (path: string, line?: number) => void;
    onCloseTab?: (path: string, saveChanges: boolean) => Promise<boolean>;
    onLookupMacro?: (name: string) => Promise<MacroDefinition[]>;
    onMacroSource?: (path: string) => string | null;
    onPeekEdit?: (definition: MacroDefinition, section: string) => void;
    onPeekSave?: (definition: MacroDefinition) => Promise<boolean>;
    onMacroNavigate?: (definition: MacroDefinition) => Promise<void>;
    onSaveAll?: () => Promise<boolean>;
    readonly?: boolean;
    canRestart?: boolean;
    restartRequired?: boolean;
    restartLabel?: string;
    hasPendingSave?: boolean;
    restartKind?: 'klipper' | 'moonraker';
    lang?: 'klipper' | 'plain';
    compareInitially?: boolean;
    loadBackup?: () => Promise<{ text: string; path: string } | null>;
    onSave: (text: string) => Promise<boolean>;
    onSaveRestart?: (text: string, klippyState: KlippyState) => Promise<boolean>;
    onRequestClose?: () => void;
    onMinimize?: () => void;
    embedded?: boolean;
    onRegisterBeforeLeave?: (callback: (() => void) | null) => void;
    onRegisterSettings?: (callback: ((anchor: HTMLElement) => void) | null) => void;
    onSettingsOpenChange?: (open: boolean) => void;
    onClose: () => void;
  } = $props();

  const api = usePluginApi();
  const i18n = api.i18n;
  const hostManagedHotkeys = api.pluginId === '@core/config';

  // The keyed dialog starts with its tab buffer so CodeMirror history is not polluted on mount.
  const initialText = () => content.replace(/\r\n?/g, '\n');
  let text = $state(initialText());
  let cmView = $state<EditorView | null>(null);
  let peek = $state.raw<PeekSpec | null>(null);
  // The Config shell commits an open macro peek before it switches or hides this child.
  $effect(() => {
    if (!embedded || !onRegisterBeforeLeave) return;
    onRegisterBeforeLeave(() => { peek?.onCommit?.(); });
    return () => onRegisterBeforeLeave(null);
  });
  let pendingPeekText: string | null = null;
  let syncPeekSection = $state<((section: string) => void) | null>(null);
  let candidateChoice = $state<{ kind: 'peek' | 'open'; candidates: MacroDefinition[]; lineEnd: number } | null>(null);
  let macroLookupError = $state('');
  let macroGestureSeq = 0;
  let useCodeMirror = $derived(!!filePath && lang === 'klipper');
  let builderActions = $state<ExtensionRef[]>([]);
  let builderRevision = 0;
  let sessionAlive = true;
  $effect(() => {
    if (api.pluginId !== '@core/config') return;
    const refresh = () => { builderActions = api.extensions.list('macro-builder'); };
    refresh();
    return api.extensions.onChange(refresh);
  });
  $effect(() => () => { sessionAlive = false; });

  /** The action receives a bounded edit closure, never the Moonraker file writer. */
  function openMacroBuilder(): void {
    const view = cmView;
    const path = filePath;
    const action = builderActions[0];
    if (!view || !path || !action || readonly || !open || loading) return;
    const printerId = api.printer.id;
    const session = createMacroBuilderSession({
      read: () => view.state.doc.toString(),
      revision: () => builderRevision,
      active: () => sessionAlive && open && filePath === path && api.printer.id === printerId && cmView === view && !readonly,
      dispatch: (from, to, insert) => view.dispatch({ changes: { from, to, insert } }),
    }, {
      printerId, path, cursor: view.state.selection.main.head,
      macroNames: [...new Set([...macroNames, ...scanMacroDefinitions(view.state.doc.toString(), path).map((item) => item.name)])],
      commands: [...catalog.values()].map((command) => ({ name: command.name, params: command.params.map((param) => param.name) })),
      objects: [...objects.objects],
      suggest: (value, cursor, variables, macroName = '') => {
        // Reuse Config's full command/Jinja resolver against a synthetic macro body.
        const prefix = '[gcode_macro BUILDER]\ngcode:\n    ';
        const context = getCompletionContext(prefix + value, prefix.length + cursor);
        if (!context) return [];
        const suggestedObjects = { ...objects, variables: new Map(objects.variables),
          variableTypes: new Map(objects.variableTypes) };
        const saved = suggestedObjects.variables.get(macroName.toUpperCase()) ?? [];
        suggestedObjects.variables.set(macroName.toUpperCase(),
          [...new Set([...saved, ...variables.map((item) => item.name)])]);
        const types = new Map(suggestedObjects.variableTypes.get(macroName.toUpperCase()) ?? []);
        for (const item of variables) {
          const type = literalType(item.value, true);
          if (type) types.set(item.name.toLowerCase(), type);
          else types.delete(item.name.toLowerCase());
        }
        suggestedObjects.variableTypes.set(macroName.toUpperCase(), types);
        return getSuggestions(context, {
          jinjaVars: [...new Set([...jinjaVars, ...variables.map((item) => item.name)])], allWords, catalog, objects: suggestedObjects,
          macroParams: macroParamNamesAt(view.state.doc.toString(), view.state.selection.main.head),
        }).map((item) => ({ ...item, from: Math.max(0, context.start - prefix.length) }));
      },
    });
    void api.extensions.invoke(action.ref, session);
  }
  let closePrompt = $state(false);
  // A save can outlive the prompt; lock its controls until the write settles.
  let closeBusy = $state(false);
  let tabClosePrompt = $state<string | null>(null);
  let tabCloseBusy = $state(false);

  /** Ask before dropping only the chosen tab's buffer; other tabs stay open. */
  async function requestTabClose(path: string): Promise<void> {
    if (tabCloseBusy || savePending || saving || !onCloseTab) return;
    peek?.onCommit?.();
    await tick();
    if (tabs.find((tab) => (tab.id ?? tab.path) === path)?.dirty) tabClosePrompt = path;
    else void confirmTabClose(path, false);
  }

  async function confirmTabClose(path: string, saveChanges: boolean): Promise<void> {
    if (!onCloseTab || tabCloseBusy) return;
    tabCloseBusy = true;
    try {
      if (await onCloseTab(path, saveChanges)) tabClosePrompt = null;
    } finally {
      tabCloseBusy = false;
    }
  }

  /** Multi-file sessions need an explicit choice before any unsaved tab is discarded. */
  async function requestClose(): Promise<void> {
    if (closeBusy || tabCloseBusy) return;
    peek?.onCommit?.();
    await tick();
    if (onRequestClose) { onRequestClose(); return; }
    if (useCodeMirror && tabs.some((tab) => tab.dirty)) closePrompt = true;
    else onClose();
  }

  /** Close only after every submitted tab is saved and no newer edits remain. */
  async function saveAllAndClose(): Promise<void> {
    if (closeBusy) return;
    closeBusy = true;
    try {
      if (await onSaveAll?.()) { closePrompt = false; onClose(); }
    } finally {
      closeBusy = false;
    }
  }
  let dirty = $state(false);
  let currentDirty = $derived(tabs.length
    ? (tabs.find((tab) => (tab.id ?? tab.path) === (activeTabId ?? filePath))?.dirty ?? dirty)
    : dirty);
  let savePending = $state(false);
  let compareMode = $state(false);
  let compareLoading = $state(false);
  let compareBackup = $state<{ text: string; path: string } | null>(null);
  let compareError = $state('');
  let editorScrollTop = $state(0);
  let compareStarted = false;
  let compareSeq = 0;

  /** Load a fresh backup on every entry; compare the saved version with the live editor buffer. */
  async function toggleCompare(): Promise<void> {
    if (!loadBackup) return;
    if (compareMode) {
      compareMode = false;
      compareSeq++;
      compareLoading = false;
      return;
    }
    compareMode = true;
    compareLoading = true;
    compareBackup = null;
    compareError = '';
    const seq = ++compareSeq;
    try {
      const result = await loadBackup();
      if (seq === compareSeq) compareBackup = result;
    } catch (error) {
      if (seq === compareSeq) compareError = error instanceof Error ? error.message : String(error);
    } finally {
      if (seq === compareSeq) compareLoading = false;
    }
  }

  $effect(() => {
    if (open && !loading && compareInitially && !compareStarted) {
      compareStarted = true;
      void toggleCompare();
    }
  });
  let printing = $state(false);

  const klippy = useKlippyState(api);
  let restartHidden = $derived(printing && klippy.ready);

  let suggestions = $state<Suggestion[]>([]);
  let suggestionPopup: HTMLDivElement | null = $state(null);
  let navigationModifierHeld = $state(false);
  let selectedIdx = $state(0);
  let acPos = $state<{ top: number; left: number } | null>(null);

  const BRACKET_PAIRS: Record<string, string> = {
    '(': ')',
    '%': '%',
    '[': ']',
    '{': '}',
    '"': '"',
    "'": "'",
  };

  // Слова файла, jinja-переменные и оглавление нужны подсказкам и навигации и могут
  // отставать на доли секунды — пересчитываем их по снимку текста с задержкой после
  // последнего нажатия, а не на каждый символ (сбор и сортировка слов — O(размер файла)).
  const SNAPSHOT_DEBOUNCE_MS = 250;
  let snapshot = $state('');
  let snapshotInitialized = false; // обычная переменная: эффект не должен зависеть от snapshot
  let snapshotTimer: ReturnType<typeof setTimeout> | null = null;

  $effect(() => {
    const t = text;
    if (!snapshotInitialized) {
      snapshotInitialized = true;
      snapshot = t; // первая загрузка — без задержки
      return;
    }
    if (snapshotTimer) clearTimeout(snapshotTimer);
    snapshotTimer = setTimeout(() => {
      snapshotTimer = null;
      snapshot = t;
    }, SNAPSHOT_DEBOUNCE_MS);
    return () => {
      if (snapshotTimer) {
        clearTimeout(snapshotTimer);
        snapshotTimer = null;
      }
    };
  });

  let jinjaVars = $derived(collectJinjaVars(snapshot));
  let allWords = $derived(collectAllWords(snapshot));

  // Команды, их параметры и значения — общий каталог (help + G-Codes.md + макросы принтера);
  // макросы из редактируемого файла перекрывают данные принтера: правки ещё не в конфиге.
  $effect(() => {
    if (!open) return;
    return attachHints(api, api.printer.id);
  });

  $effect(() => {
    if (!open || !hostManagedHotkeys) return;
    // The host owns effective combinations; the mounted dialog only exposes actions.
    return registerEditorHotkeys(api.pluginId, performEditorHotkey);
  });
  let localMacros = $derived(scanLocalMacros(snapshot));
  let catalog = $derived(mergeLocalMacros(getCatalog(api.printer.id), localMacros));
  // имена объектов (FAN=, HEATER=…, printer[...]): секции принтера + секции и макросы файла
  let objects = $derived(
    mergeObjectIndex(getObjects(api.printer.id), {
      sections: scanSectionNames(snapshot),
      macros: localMacros,
    }),
  );

  let preEl = $state<HTMLPreElement | null>(null);
  let inputEl = $state<HTMLTextAreaElement | null>(null);
  let gutterPreEl = $state<HTMLPreElement | null>(null);
  let comparePaneEl = $state<HTMLDivElement | null>(null);
  $effect(() => {
    // Switching layouts must not reset the current editor's scroll position.
    if (comparePaneEl && inputEl) comparePaneEl.scrollTop = inputEl.scrollTop;
    else if (comparePaneEl && cmView) comparePaneEl.scrollTop = cmView.scrollDOM.scrollTop;
  });
  let searchInputEl = $state<HTMLInputElement | null>(null);
  let replaceInputEl = $state<HTMLInputElement | null>(null);

  // Textarea прозрачный, текст виден ТОЛЬКО через слой подсветки, поэтому слой обязан
  // обновляться синхронно с вводом. Один {@html} целиком — намеренно: браузер вставляет
  // готовый HTML нативно и быстрее, чем Svelte обслуживает по блоку на каждую из
  // строк ({#each} + {@html} на строку заметно тормозил набор).
  // + zero-width space на пустой последней строке (см. toRenderLines в highlight.ts).
  let currentLineMarks = $derived(compareMode && compareBackup
    ? configCurrentLineMarks(compareBackup.text, text)
    : new Map<number, 'added' | 'removed' | 'changed'>());
  let compareHunks = $derived(compareMode && compareBackup ? configDiffHunks(compareBackup.text, text) : []);
  let html = $derived.by(() => {
    const lines = toRenderLines(
      lang === 'klipper' ? highlightKlipperLines(text) : highlightPlainLines(text),
      text,
    );
    // Keep the syntax layer under the same textarea while comparison changes live.
    return lines.map((line, index) => {
      const mark = currentLineMarks.get(index + 1);
      if (!mark) return line;
      const newline = line.endsWith('\n') ? '\n' : '';
      const body = newline ? line.slice(0, -1) : line;
      return `<span class="compare-line ${mark}">${body}</span>${newline}`;
    }).join('');
  });

  $effect(() => {
      void content;
      void loading;
      const norm = content.replace(/\r\n?/g, '\n');
      // Пока savePending — не перезаписываем text из пропа, даже если dirty=false
      if (open && !dirty && !savePending && text !== norm) {
          text = norm;
          if (inputEl && inputEl.value !== norm) inputEl.value = norm;
      }
  });

  $effect(() => {
    if (!open) return;
    return api.moonrakerFor(api.printer.id).subscribe(
      { print_stats: ['state'] },
      (d: any) => {
        const st = d?.print_stats?.state;
        if (typeof st === 'string') printing = st === 'printing' || st === 'paused';
      },
      { immediate: true },
    );
  });

  // Пока редактор открыт, hotkeys плагинов (переключение вкладок и т.п.) должны молчать:
  // он модальный и перекрывает страницу.
  $effect(() => {
    if (!open) return;
    // untrack: `++` читает и пишет одно состояние; без untrack эффект зависел бы от
    // собственной записи и перезапускался бы бесконечно
    untrack(() => {
      editorUi.openCount++;
    });
    return () => {
      untrack(() => {
        editorUi.openCount--;
      });
    };
  });

    // Глобальный обработчик хоткеев редактора. Работает независимо от фокуса
  // внутри редактора и использует e.code, чтобы ловить хоткеи на любой раскладке.
  $effect(() => {
    if (!open) return;

    function onWindowKey(e: KeyboardEvent): void {
      const mod = e.ctrlKey || e.metaKey;
      if (mod || e.key === 'Control' || e.key === 'Meta') {
        // Navigation chords should never compete with the completion popup.
        navigationModifierHeld = true;
        closeSuggestions();
        if (suggestTimer) { clearTimeout(suggestTimer); suggestTimer = null; }
      }
      if (!mod) return;
      if (hostManagedHotkeys) return;

      // Ctrl+F — поиск (работает в readonly тоже)
      if (e.code === 'KeyF' || e.key.toLowerCase() === 'f') {
        e.preventDefault();
        openSearch(false);
        return;
      }
      // Ctrl+H — замена (только при редактировании)
      if (!readonly && (e.code === 'KeyH' || e.key.toLowerCase() === 'h')) {
        e.preventDefault();
        openSearch(true);
        return;
      }
      // Ctrl+S — сохранение (только при редактировании и наличии изменений)
      if (!readonly && (e.code === 'KeyS' || e.key.toLowerCase() === 's')) {
        // Всегда гасим диалог «сохранить страницу» браузера; пишем только при изменениях
        e.preventDefault();
        if (peek && (document.activeElement as HTMLElement | null)?.closest('.cm-peek')) {
          peek.onSave();
          return;
        }
        if (currentDirty && !savePending) save();
        return;
      }
    }

    function onWindowKeyUp(e: KeyboardEvent): void {
      if (!navigationModifierHeld || e.ctrlKey || e.metaKey) return;
      navigationModifierHeld = false;
      // Completion resumes with the next edit or cursor move, after navigation finishes.
    }

    function onWindowBlur(): void {
      navigationModifierHeld = false;
    }

    window.addEventListener('keydown', onWindowKey, true); // capture: раньше браузера
    window.addEventListener('keyup', onWindowKeyUp, true);
    window.addEventListener('blur', onWindowBlur);
    return () => {
      window.removeEventListener('keydown', onWindowKey, true);
      window.removeEventListener('keyup', onWindowKeyUp, true);
      window.removeEventListener('blur', onWindowBlur);
    };
  });

  // ------------------------------------------------------------------
  // Нумерация строк
  // ------------------------------------------------------------------

  // Без split: на каждое нажатие не создаём массив строк всего файла
  function countLines(s: string): number {
    let n = 1;
    for (let i = s.indexOf('\n'); i !== -1; i = s.indexOf('\n', i + 1)) n++;
    return n;
  }
  let lineCount = $derived(countLines(text));

  let gutterText = $derived.by(() => {
    let s = '';
    for (let i = 1; i <= lineCount; i++) {
      if (compareMode && compareBackup) {
        const mark = currentLineMarks.get(i);
        s += `${mark === 'changed' ? '±' : mark === 'added' ? '+' : mark === 'removed' ? '−' : ' '}${i}\n`;
      } else {
        s += `${i}\n`;
      }
    }
    return s;
  });

  // ширина гаттера в ch: цифры + отступ; моноширинный шрифт → ch точен
  let gutterWidthCh = $derived(String(lineCount).length + (compareMode && compareBackup ? 4 : 3));

  // ------------------------------------------------------------------
  // Оглавление секций (только lang=klipper)
  // ------------------------------------------------------------------

  // Десктоп: колонка сбоку (tocOpen). Узкий экран: шторка поверх редактора (tocSheetOpen) —
  // состояния раздельные, поэтому шторка не меняет выбор пользователя для десктопа.
  let tocOpen = $state(true);
  let tocSheetOpen = $state(false);

  const narrowState = useNarrow();
  let narrow = $derived(narrowState.value);
  let tocVisible = $derived(narrow ? tocSheetOpen : tocOpen);

  function toggleToc(): void {
    if (narrow) {
      tocSheetOpen = !tocSheetOpen;
      if (tocSheetOpen) {
        colorsOpen = false;
        closeDevices();
        closeHelp();
      }
    } else {
      tocOpen = !tocOpen;
    }
  }

  // ------------------------------------------------------------------
  // Справка по секции (Klipper Config_Reference.md через Moonraker, root docs)
  // ------------------------------------------------------------------

  // у moonraker.conf другие секции — Klipper-справка к ним не относится
  let helpEnabled = $derived(lang === 'klipper' && restartKind !== 'moonraker');
  let helpTarget = $state<{ section: string; anchor: Anchor } | null>(null);
  let helpView = $state<HelpView>({ status: 'loading' });
  let helpSeq = 0; // устаревший ответ (закрыли / открыли другую секцию) отбрасывается

  async function openHelp(section: string, anchor: Anchor): Promise<void> {
    if (!helpEnabled) return;
    const seq = ++helpSeq;
    colorsOpen = false;
    closeDevices();
    helpTarget = { section, anchor };
    helpView = { status: 'loading' };
    try {
      const index = await loadReference(api);
      if (seq !== helpSeq) return;
      const fragment = resolveSection(index, section);
      helpView = fragment
        ? { status: 'ready', fragment, blocks: parseBlocks(fragment.body) }
        : { status: 'notFound' };
    } catch (e) {
      if (seq !== helpSeq) return;
      const { kind, message } = classifyReferenceError(e);
      helpView = kind === 'unavailable' ? { status: 'unavailable' } : { status: 'error', message };
    }
  }

  function closeHelp(): void {
    helpSeq++;
    helpTarget = null;
  }

  function onTocHelp(e: MouseEvent, name: string): void {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    if (narrow) tocSheetOpen = false;
    // оглавление справа — раскрываем справку влево от него, на уровне пункта
    void openHelp(name, { left: r.left - HELP_WIDTH - 8, top: r.top, bottom: r.bottom });
  }

  function onTocPick(line: number): void {
    // на узком экране без фокуса: иначе jumpToIndex поднимет экранную клавиатуру
    jumpToLine(line, !narrow);
    if (narrow) tocSheetOpen = false;
  }

  // шторка живёт только на узком экране и только пока открыт диалог
  $effect(() => {
    if (!narrow || !open) tocSheetOpen = false;
  });

  // ------------------------------------------------------------------
  // Цвета подсветки (только lang=klipper): CSS-переменные --tok-* на оверлее
  // ------------------------------------------------------------------

  let hostTheme = $state<ThemeName>(api.theme.current);
  $effect(() => api.onThemeChange((t) => { hostTheme = t; }));

  let colorsOpen = $state(false);
  let colorsPosition = $state({ top: 0, start: 0 });
  let devicesPosition = $state({ top: 0, start: 0 });
  let overrides = $derived(getOverrides(hostTheme));
  let colorStyle = $derived(toStyle(hostTheme, overrides));

  // The shell owns the Settings button, while this editor keeps the color controls and theme state.
  $effect(() => {
    if (!embedded || lang !== 'klipper' || !onRegisterSettings) return;
    onRegisterSettings((anchor) => toggleColors(anchor));
    return () => onRegisterSettings(null);
  });
  $effect(() => {
    onSettingsOpenChange?.(colorsOpen);
    return () => onSettingsOpenChange?.(false);
  });

  // ColorPickerMenu ждёт ключи cp.*, которых в ft-пространстве имён нет
  const pickerI18n = {
    t: (key: string) => i18n.t(key.startsWith('cp.') ? `ft.hl.${key.slice(3)}` : key),
  };

  // значения могли измениться из другой копии модуля (другой плагин) — перечитываем
  $effect(() => {
    if (open) reloadColors();
    else {
      colorsOpen = false;
      closeDevices();
      closeHelp();
    }
  });

  function pickColor(key: TokKey, hex: string | null): void {
    setColor(hostTheme, key, hex);
  }

  // ------------------------------------------------------------------
  // Подключённые устройства (только lang=klipper): machine.peripherals.*
  // ------------------------------------------------------------------

  type DevStatus = 'idle' | 'loading' | 'ready' | DeviceErrorStatus;
  interface DevState {
    status: DevStatus;
    cards: DeviceCard[];
    error: string;
  }

  const freshDevState = (): Record<DeviceKind, DevState> => ({
    serial: { status: 'idle', cards: [], error: '' },
    canbus: { status: 'idle', cards: [], error: '' },
    usb: { status: 'idle', cards: [], error: '' },
    video: { status: 'idle', cards: [], error: '' },
  });

  let devicesOpen = $state(false);
  let devTab = $state<DeviceKind>('serial');
  let devState = $state<Record<DeviceKind, DevState>>(freshDevState());
  let canInterface = $state(DEFAULT_CAN_INTERFACE);
  let canInterfaceOk = $derived(isValidCanInterface(canInterface));
  let copiedKey = $state<string | null>(null);
  let copiedTimer: ReturnType<typeof setTimeout> | null = null;

  // номер последнего запроса по вкладке: устаревший ответ (панель закрыли, нажали
  // «Обновить» ещё раз) отбрасывается
  const devSeq: Record<DeviceKind, number> = { serial: 0, canbus: 0, usb: 0, video: 0 };

  // вставка возможна, только пока в DOM есть textarea (нет readonly и загрузки)
  let canInsert = $derived(!readonly && !loading && (inputEl !== null || cmView !== null));

  $effect(() => () => {
    if (copiedTimer) clearTimeout(copiedTimer);
  });

  async function loadTab(kind: DeviceKind): Promise<void> {
    const seq = ++devSeq[kind];
    devState[kind] = { status: 'loading', cards: [], error: '' };
    try {
      // Keep handle lookup inside the try because an empty or stale printer ID is recoverable UI state.
      const handle = api.moonrakerFor(api.printer.id);
      const cards = await loadDevices((m, p) => handle.request(m, p), kind, { canInterface });
      if (seq !== devSeq[kind]) return;
      devState[kind] = { status: 'ready', cards, error: '' };
    } catch (e) {
      if (seq !== devSeq[kind]) return;
      const { status, message } = classifyError(e);
      devState[kind] = { status, cards: [], error: message };
    }
  }

  function closeDevices(): void {
    devicesOpen = false;
    for (const k of DEVICE_KINDS) devSeq[k]++;
    devState = freshDevState();
  }

  /** Clamp a fixed popover to the viewport on both sides of an LTR or RTL trigger. */
  function popoverPosition(anchor: HTMLElement, preferredWidth: number): { top: number; start: number } {
    const rect = anchor.getBoundingClientRect();
    const width = Math.min(preferredWidth, Math.max(0, window.innerWidth - 16));
    const desiredLeft = uiDir === 'rtl' ? rect.right - width : rect.left;
    const left = Math.max(8, Math.min(desiredLeft, window.innerWidth - width - 8));
    return {
      top: Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - 80)),
      start: uiDir === 'rtl' ? window.innerWidth - left - width : left,
    };
  }

  function toggleDevices(anchor?: HTMLElement): void {
    if (devicesOpen) {
      closeDevices();
      return;
    }
    colorsOpen = false;
    if (anchor) devicesPosition = popoverPosition(anchor, 460);
    tocSheetOpen = false;
    closeHelp();
    devicesOpen = true;
    // CAN-опрос сканирует шину и может быть долгим — только по кнопке
    if (devTab !== 'canbus') void loadTab(devTab);
  }

  function toggleColors(anchor?: HTMLElement): void {
    if (!colorsOpen && anchor) colorsPosition = popoverPosition(anchor, 300);
    colorsOpen = !colorsOpen;
    if (colorsOpen) {
      closeDevices();
      tocSheetOpen = false;
      closeHelp();
    }
  }

  function selectDevTab(kind: DeviceKind): void {
    devTab = kind;
    if (kind !== 'canbus' && devState[kind].status === 'idle') void loadTab(kind);
  }

  async function copyValue(key: string, value: string): Promise<void> {
    if (!(await copyText(value))) return;
    copiedKey = key;
    if (copiedTimer) clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => {
      copiedKey = null;
      copiedTimer = null;
    }, 1500);
  }

  function insertDeviceValue(value: string): void {
    if (cmView) {
      const selection = cmView.state.selection.main;
      closeDevices();
      replaceRange(selection.from, selection.to, value);
      return;
    }
    const ta = inputEl;
    if (!ta) return;
    // позицию читаем до закрытия панели; у textarea она сохраняется и без фокуса
    const start = ta.selectionStart ?? ta.value.length;
    const end = ta.selectionEnd ?? start;
    closeDevices();
    replaceRange(start, end, value);
    requestAnimationFrame(() => {
      if (!inputEl) return;
      inputEl.selectionStart = inputEl.selectionEnd = start + value.length;
      inputEl.focus();
    });
  }

  // направление интерфейса для локализованных элементов внутри LTR-области кода
  let uiDir = $state<'ltr' | 'rtl'>(document.documentElement.getAttribute('dir') === 'rtl' ? 'rtl' : 'ltr');
  $effect(() => api.onLocaleChange((_l, dir) => { uiDir = dir; }));

  interface TocItem {
    name: string;
    line: number;
  }

  // секции могут повторяться — не дедуплицируем, ключ по индексу
  let toc = $derived.by(() => {
    if (lang !== 'klipper') return [] as TocItem[];
    const items: TocItem[] = [];
    const re = /^\s*\[([^\]]+)\]/;
    let line = 0;
    for (const l of snapshot.split('\n')) {
      const m = re.exec(l);
      if (m) items.push({ name: (m[1] ?? '').trim(), line });
      line++;
    }
    return items;
  });

  function jumpToLine(line: number, focus = true): void {
    const lines = text.split('\n');
    let idx = 0;
    for (let i = 0; i < line && i < lines.length; i++) idx += (lines[i] ?? '').length + 1;
    jumpToIndex(idx, focus);
  }

  // ------------------------------------------------------------------
  // Поиск / замена
  // ------------------------------------------------------------------

  let searchOpen = $state(false);
  let replaceMode = $state(false);
  let query = $state('');
  let replaceWith = $state('');
  let caseSensitive = $state(false);
  let matchIdx = $state(-1);

  interface Match {
    start: number;
    end: number;
  }

  let matches = $derived.by(() => {
    if (!searchOpen || !query) return [] as Match[];
    const hay = caseSensitive ? text : text.toLowerCase();
    const needle = caseSensitive ? query : query.toLowerCase();
    const out: Match[] = [];
    let i = hay.indexOf(needle);
    while (i !== -1 && out.length < 5000) {
      out.push({ start: i, end: i + needle.length });
      i = hay.indexOf(needle, i + needle.length);
    }
    return out;
  });

  function openSearch(replace: boolean): void {
    searchOpen = true;
    if (replace && !readonly) replaceMode = true;
    requestAnimationFrame(() => {
      const el = replaceMode && !readonly ? replaceInputEl : searchInputEl;
      el?.focus();
      el?.select();
    });
  }

  function closeSearch(): void {
    searchOpen = false;
    replaceMode = false;
    matchIdx = -1;
    // The search input is removed; keep the next editor shortcut inside the modal context.
    void tick().then(() => { if (cmView) cmView.focus(); else inputEl?.focus(); });
  }

  function setScrollTop(top: number): void {
    if (cmView) { cmView.scrollDOM.scrollTop = top; return; }
    if (preEl) preEl.scrollTop = top;
    if (inputEl) inputEl.scrollTop = top;
    if (gutterPreEl) gutterPreEl.scrollTop = top;
  }

  function scrollToShow(idx: number): void {
    if (cmView) { cmView.dispatch({ selection: { anchor: idx }, scrollIntoView: true }); return; }
    const line = text.slice(0, idx).split('\n').length - 1;
    const lh = lineHeightPx();
    const viewH = inputEl?.clientHeight ?? preEl?.clientHeight ?? 0;
    setScrollTop(Math.max(0, line * lh - viewH / 2));
  }

  function gotoMatch(i: number): void {
    if (matches.length === 0) {
      matchIdx = -1;
      return;
    }
    matchIdx = ((i % matches.length) + matches.length) % matches.length;
    const m = matches[matchIdx]!;
    // подсветка текущего совпадения — выделением в textarea
    // (selection-фон виден даже при прозрачном тексте)
    if (inputEl) {
      inputEl.focus();
      inputEl.setSelectionRange(m.start, m.end);
    } else if (cmView) {
      cmView.dispatch({ selection: { anchor: m.start, head: m.end }, scrollIntoView: true });
      cmView.focus();
    }
    scrollToShow(m.start);
  }

  function replaceCurrent(): void {
    if (readonly || matches.length === 0) return;
    const m = matches[matchIdx] ?? matches[0];
    if (!m) return;
    replaceRange(m.start, m.end, replaceWith);
    gotoMatch(matchIdx); // пересчёт и выбор следующего совпадения на той же позиции
  }

  function replaceAll(): void {
    if (readonly || matches.length === 0) return;
    const parts: string[] = [];
    let last = 0;
    for (const m of matches) {
      parts.push(text.slice(last, m.start), replaceWith);
      last = m.end;
    }
    parts.push(text.slice(last));
    // одной операцией — один шаг undo
    replaceRange(0, text.length, parts.join(''));
    matchIdx = -1;
  }

  // ------------------------------------------------------------------
  // Редактирование
  // ------------------------------------------------------------------

  /**
   * Вставка с сохранением нативного undo (Ctrl+Z):
   * execCommand('insertText') проходит как пользовательский ввод,
   * oninput сам обновит text/dirty.
   */
  function replaceRange(start: number, end: number, insert: string, focus = true): void {
    if (cmView) {
      cmView.dispatch(focus
        ? { changes: { from: start, to: end, insert }, selection: { anchor: start + insert.length } }
        : { changes: { from: start, to: end, insert } });
      if (focus) cmView.focus();
      return;
    }
    const ta = inputEl;
    if (!ta) return;
    const result = replaceEditorRange(ta, start, end, insert);
    if (!result.nativeUndo) {
      text = result.value;
      dirty = true;
      scheduleSuggestions();
    }
  }

  /** Stage the complete backup in the current editor without writing either file. */
  function restoreBackupToBuffer(): void {
    if (!compareBackup || readonly || savePending || saving || text === compareBackup.text) return;
    replaceRange(0, text.length, compareBackup.text);
  }

  /** Apply one still-current diff hunk; a stale click must not replace another edit. */
  function applyBackupHunk(hunk: ConfigDiffHunk): void {
    if (!compareBackup || readonly || savePending || saving) return;
    if (!compareHunks.includes(hunk)) return;
    const edit = configBackupHunkEdit(compareBackup.text, text, hunk);
    replaceRange(edit.start, edit.end, edit.insert);
  }

  function onInput(e: Event): void {
    text = (e.currentTarget as HTMLTextAreaElement).value;
    dirty = true;
    // A persistent owner needs plain-text changes before this keyed dialog unmounts.
    onBufferChange?.(text);
    scheduleSuggestions();
  }

  function onCursorMove(): void {
    scheduleSuggestions();
  }

  const NAV_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']);

  /** keyup: пересчёт подсказок только для навигации; набор символов уже учтён в oninput. */
  function onKeyUp(e: KeyboardEvent): void {
    if (!NAV_KEYS.has(e.key)) return;
    // стрелки вверх/вниз при открытом списке выбирают пункт — список не трогаем
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && suggestions.length > 0) return;
    onCursorMove();
  }

  // Пересчёт подсказок (разбор контекста — O(позиция курсора)) вынесен из пути ввода:
  // нажатие сначала прячет устаревший список, пересчёт идёт после короткой паузы.
  const SUGGEST_DELAY_MS = 60;
  let suggestTimer: ReturnType<typeof setTimeout> | null = null;

  function scheduleSuggestions(): void {
    if (suggestions.length > 0) closeSuggestions();
    if (suggestTimer) clearTimeout(suggestTimer);
    if (navigationModifierHeld) { suggestTimer = null; return; }
    suggestTimer = setTimeout(() => {
      suggestTimer = null;
      updateSuggestions();
    }, SUGGEST_DELAY_MS);
  }

  $effect(() => () => {
    if (suggestTimer) clearTimeout(suggestTimer);
  });

  async function save(): Promise<void> {
    if (savePending || saving) return;
    savePending = true;
    const submitted = text;
    try {
      if (await onSave(submitted)) {
        if (text === submitted) dirty = false;
        // A successful save replaces the backup; refresh the visible comparison baseline.
        if (compareMode && loadBackup) {
          try {
            compareBackup = await loadBackup();
            compareError = '';
          } catch (error) {
            compareError = error instanceof Error ? error.message : String(error);
          }
        }
      }
    } finally {
      // A failed backup or upload must leave the buffer dirty for another attempt.
      savePending = false;
    }
  }

  async function saveRestart(): Promise<void> {
    if (savePending || saving || !onSaveRestart) return;
    savePending = true;
    const submitted = text;
    try {
      if (await onSaveRestart(submitted, klippy.state) && text === submitted) dirty = false;
    } finally {
      savePending = false;
    }
  }

  const INDENT = '    '; // 4 пробела

  /** Execute an editor command after the host has resolved the user's effective binding. */
  function performEditorHotkey(action: EditorHotkeyAction, event?: KeyboardEvent): void {
    if (action === 'find') { openSearch(false); return; }
    if (action === 'replace') { if (!readonly) openSearch(true); return; }
    if (action === 'save') {
      if (readonly || savePending) return;
      const insidePeek = event?.composedPath().some((node) => node instanceof HTMLElement && node.classList.contains('cm-peek'))
        ?? Boolean((document.activeElement as HTMLElement | null)?.closest('.cm-peek'));
      if (peek && insidePeek) { peek.onSave(); return; }
      if (currentDirty) void save();
      return;
    }
    if (action === 'help') {
      if (!helpEnabled) return;
      const idx = cmView?.state.selection.main.head ?? inputEl?.selectionStart ?? 0;
      const hit = sectionAbove(text, idx);
      if (hit && cmView) {
        const box = cmView.coordsAtPos(idx);
        if (box) void openHelp(hit.name, { left: box.left, top: box.top, bottom: box.bottom });
      } else if (hit && inputEl) void openHelp(hit.name, caretAnchor(inputEl, idx));
      return;
    }
    if (action === 'peek' || action === 'open') {
      if (cmView && useCodeMirror) onCodeMirrorGesture(cmView.state.selection.main.head, action);
      return;
    }
    // Escape closes the innermost layer before asking to discard unsaved buffers.
    if (suggestions.length) { closeSuggestions(); return; }
    if (tabClosePrompt) { if (!tabCloseBusy) tabClosePrompt = null; return; }
    if (closePrompt) { if (!closeBusy) closePrompt = false; return; }
    if (candidateChoice) { candidateChoice = null; return; }
    if (peek) { peek.onClose(); return; }
    if (helpTarget) { closeHelp(); return; }
    if (colorsOpen) { colorsOpen = false; return; }
    if (devicesOpen) { closeDevices(); return; }
    if (tocSheetOpen) { tocSheetOpen = false; return; }
    if (searchOpen) { closeSearch(); return; }
    requestClose();
  }

  function onKeydown(e: KeyboardEvent): void {
    if (e.defaultPrevented) return;
    // поиск/замена перехватываются раньше Escape-логики редактора
    if (!hostManagedHotkeys && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      performEditorHotkey('find');
      return;
    }
    if (!hostManagedHotkeys && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'h') {
      e.preventDefault();
      performEditorHotkey('replace');
      return;
    }

    // F1 — справка по секции, в которой стоит каретка (из любого места её тела)
    if (!hostManagedHotkeys && e.key === 'F1' && helpEnabled) {
      e.preventDefault();
      performEditorHotkey('help');
      return;
    }

    if (!hostManagedHotkeys && e.key === 'Escape') {
      e.stopPropagation();
      performEditorHotkey('close');
      return;
    }

    if (!hostManagedHotkeys && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      performEditorHotkey('save');
      return;
    }

    // ---------------- автопарные скобки ----------------
    if (!readonly && inputEl && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const ta = inputEl;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;

      // открывающая: вставляем пару, курсор между ними
      const close = BRACKET_PAIRS[e.key];
      if (close && start === end) {
        const nextCh = text[start] ?? '';
        const isQuote = e.key === '"' || e.key === "'";
        const quoteOk = !isQuote || nextCh === '' || /[\s)\]}]/.test(nextCh);
        if (quoteOk) {
          e.preventDefault();
          replaceRange(start, end, e.key + close);
          requestAnimationFrame(() => {
            ta.selectionStart = ta.selectionEnd = start + 1;
            updateSuggestions();
          });
          return;
        }
      }

      // закрывающая: если она УЖЕ стоит сразу за курсором — не дублируем,
      // просто перепрыгиваем (иначе получаем "))" при привычном доборе)
      if (
        (e.key === ')' || e.key === ']' || e.key === '}' || e.key === '"' || e.key === "'") &&
        start === end &&
        text[start] === e.key
      ) {
        e.preventDefault();
        requestAnimationFrame(() => {
          ta.selectionStart = ta.selectionEnd = start + 1;
          updateSuggestions();
        });
        return;
      }
    }

    // Tab / Shift+Tab — индент/дединт
    if (e.key === 'Tab' && !readonly && inputEl) {
      e.preventDefault();
      const ta = inputEl;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;

      if (start === end) {
        e.preventDefault();
        replaceRange(start, end, INDENT);
        requestAnimationFrame(() => {
          ta.selectionStart = ta.selectionEnd = start + INDENT.length;
          updateSuggestions();
        });
        return;
      }

      // есть выделение — применяем ко всем строкам в диапазоне
      const lineStart = beforeLastNewline(text, start);
      const lineEnd = afterNextNewline(text, end);
      const block = text.slice(lineStart, lineEnd);
      const lines = block.split('\n');

      const indented = e.shiftKey
        ? lines.map((l) => (l.startsWith(INDENT) ? l.slice(INDENT.length) : l.replace(/^\t/, '')))
        : lines.map((l) => (l === '' ? l : INDENT + l));

      const newBlock = indented.join('\n');

      // сохранить выделение на том же блоке
      replaceRange(lineStart, lineEnd, newBlock);
      requestAnimationFrame(() => {
        ta.selectionStart = lineStart;
        ta.selectionEnd = lineStart + newBlock.length;
        updateSuggestions();
      });
    }
  }

  function beforeLastNewline(s: string, idx: number): number {
    const i = s.lastIndexOf('\n', idx - 1);
    return i < 0 ? 0 : i + 1;
  }

  function afterNextNewline(s: string, idx: number): number {
    const i = s.indexOf('\n', idx);
    return i < 0 ? s.length : i;
  }

  function syncScroll(e: Event): void {
    const ta = e.currentTarget as HTMLTextAreaElement;
    if (preEl) {
      preEl.scrollTop = ta.scrollTop;
      preEl.scrollLeft = ta.scrollLeft;
    }
    if (gutterPreEl) gutterPreEl.scrollTop = ta.scrollTop;
    if (comparePaneEl) comparePaneEl.scrollTop = ta.scrollTop;
    editorScrollTop = ta.scrollTop;
  }

  /** Пересчитать подсказки по текущему положению курсора. */
  function updateSuggestions(): void {
    if (navigationModifierHeld || (!inputEl && !cmView)) {
      suggestions = [];
      acPos = null;
      return;
    }
    const cursor = cmView?.state.selection.main.head ?? inputEl?.selectionStart ?? 0;
    const ctx = getCompletionContext(text, cursor);
    if (!ctx) {
      suggestions = [];
      acPos = null;
      return;
    }
    const items = getSuggestions(ctx, {
      jinjaVars,
      allWords,
      catalog,
      objects,
      macroParams: ctx.inJinja ? macroParamNamesAt(text, cursor) : null,
    });
    if (items.length === 0) {
      suggestions = [];
      acPos = null;
      return;
    }
    suggestions = items;
    selectedIdx = Math.min(selectedIdx, items.length - 1);
    if (cmView) {
      const coords = cmView.coordsAtPos(cursor);
      if (coords) acPos = { top: Math.min(coords.bottom, window.innerHeight - 284), left: Math.max(4, Math.min(coords.left, window.innerWidth - 524)) };
    } else if (inputEl) acPos = computePopupPos(inputEl, cursor, items.length);
  }

  // ---------------- позиция подсказок ----------------
  //
  // Шрифт редактора моноширинный, textarea — `white-space: pre` (без переносов), поэтому
  // координаты каретки считаются арифметикой: колонка × ширина символа, строка × высота
  // строки. Раньше позицию мерили скрытым зеркальным div с `pre-wrap`: длинные строки
  // там переносились, чего в textarea нет, и подсказка уезжала вниз тем сильнее, чем
  // больше таких строк выше курсора (особенно заметно после прокрутки вниз). Зеркало
  // ещё и принудительно считало layout на каждое нажатие.

  interface CaretMetrics {
    charW: number;
    lineH: number;
    padL: number;
    padT: number;
    tab: number;
  }
  let caretMetrics: CaretMetrics | null = null;
  let measureCanvas: HTMLCanvasElement | null = null;

  // у слоя подсветки (<pre>) и textarea одинаковые шрифт и отступы — метрики общие
  function readCaretMetrics(ta: HTMLElement): CaretMetrics {
    if (caretMetrics) return caretMetrics;
    const cs = getComputedStyle(ta);
    measureCanvas ??= document.createElement('canvas');
    const ctx = measureCanvas.getContext('2d');
    let charW = 0;
    if (ctx) {
      ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      charW = ctx.measureText('M'.repeat(64)).width / 64;
    }
    const fontPx = parseFloat(cs.fontSize) || 14;
    caretMetrics = {
      charW: charW || fontPx * 0.6,
      lineH: parseFloat(cs.lineHeight) || fontPx * 1.5,
      padL: parseFloat(cs.paddingLeft) || 0,
      padT: parseFloat(cs.paddingTop) || 0,
      tab: parseInt(cs.tabSize, 10) || 4,
    };
    return caretMetrics;
  }

  // метрики зависят от шрифта/масштаба: сбрасываем при ресайзе и повторном открытии
  $effect(() => {
    if (!open) return;
    caretMetrics = null;
    const reset = () => {
      caretMetrics = null;
    };
    window.addEventListener('resize', reset);
    return () => window.removeEventListener('resize', reset);
  });

  /** Позиционируем dropdown (position: fixed) под кареткой, с разворотом вверх у нижнего края. */
  function computePopupPos(
    ta: HTMLTextAreaElement,
    cursor: number,
    itemCount: number,
  ): { top: number; left: number } {
    const m = readCaretMetrics(ta);

    // строка каретки и визуальная колонка (табуляция выравнивает по tab-size)
    const { line, col } = caretLineCol(text, cursor, m.tab);

    const rect = ta.getBoundingClientRect();
    let left = rect.left + m.padL + col * m.charW - ta.scrollLeft;
    const caretTop = rect.top + m.padT + line * m.lineH - ta.scrollTop;
    let top = caretTop + m.lineH;

    // popup: max-width 420, max-height 280 (см. .ac-popup)
    const popupH = Math.min(280, itemCount * 26 + 8);
    if (top + popupH > window.innerHeight && caretTop - popupH > 0) top = caretTop - popupH;
    left = Math.max(4, Math.min(left, window.innerWidth - 524));

    return { top, left };
  }

  /** Экранные координаты строки с кареткой — якорь для popover справки. */
  function caretAnchor(ta: HTMLTextAreaElement, cursor: number): Anchor {
    const m = readCaretMetrics(ta);
    const { line, col } = caretLineCol(text, cursor, m.tab);
    const rect = ta.getBoundingClientRect();
    const top = rect.top + m.padT + line * m.lineH - ta.scrollTop;
    return { left: rect.left + m.padL + col * m.charW - ta.scrollLeft, top, bottom: top + m.lineH };
  }

  function acceptSuggestion(s: Suggestion): void {
    if (!inputEl && !cmView) return;
    const cursor = cmView?.state.selection.main.head ?? inputEl?.selectionStart ?? 0;
    const ctx = getCompletionContext(text, cursor);
    if (!ctx) return;

    replaceRange(ctx.start, ctx.end, s.insert);
    suggestions = [];
    acPos = null;

    requestAnimationFrame(() => {
      if (cmView) { cmView.focus(); return; }
      if (!inputEl) return;
      inputEl.selectionStart = inputEl.selectionEnd = ctx.start + s.insert.length;
      inputEl.focus();
    });
  }

  const KIND_BADGE: Record<Suggestion['kind'], string> = {
    var: 'v',
    cmd: 'G',
    macro: 'M',
    param: 'p',
    value: '=',
    word: 'w',
  };

  function closeSuggestions(): void {
    suggestions = [];
    acPos = null;
  }

  /** Let the popup own navigation and acceptance whenever it is visible. */
  function onSuggestionKey(key: string): boolean {
    if (suggestions.length === 0) return false;
    if (key === 'ArrowDown') {
      selectedIdx = (selectedIdx + 1) % suggestions.length;
      return true;
    }
    if (key === 'ArrowUp') {
      selectedIdx = (selectedIdx - 1 + suggestions.length) % suggestions.length;
      return true;
    }
    if (key === 'Enter' || key === 'Tab') {
      acceptSuggestion(suggestions[selectedIdx]!);
      return true;
    }
    if (key === 'Escape') {
      closeSuggestions();
      return true;
    }
    return false;
  }

  $effect(() => {
    // Keep keyboard selection visible when a long completion list scrolls.
    void selectedIdx;
    suggestionPopup?.querySelector('.ac-item.selected')?.scrollIntoView({ block: 'nearest' });
  });

  // ---------------- Ctrl+click jump ----------------

  function lineHeightPx(): number {
    const el = (preEl ?? inputEl) as HTMLElement | null;
    return el ? parseFloat(getComputedStyle(el).lineHeight) || 21 : 21;
  }

  function wordAt(idx: number): string | null {
    let s = idx;
    while (s > 0 && /[\w.]/.test(text[s - 1] ?? '')) s--;
    let e = idx;
    while (e < text.length && /[\w.]/.test(text[e] ?? '')) e++;
    const base = (text.slice(s, e).split('.').pop() ?? '') as string;
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(base) ? base : null;
  }

  function findDeclaration(word: string): number | null {
    const safe = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = new RegExp(`\\{%-?[^%]*\\bset\\s+${safe}\\b`).exec(text);
    return m ? m.index : null;
  }

  function jumpToIndex(idx: number, focus = true): void {
    if (cmView) {
      cmView.dispatch({ selection: { anchor: idx }, scrollIntoView: true });
      if (focus) cmView.focus();
      return;
    }
    const line = text.slice(0, idx).split('\n').length - 1;
    const top = Math.max(0, line * lineHeightPx() - lineHeightPx() * 3);
    setScrollTop(top);
    if (inputEl) {
      if (focus) inputEl.focus();
      inputEl.setSelectionRange(idx, idx);
    }
  }

  function onEditorClick(e: MouseEvent): void {
    if (!(e.ctrlKey || e.metaKey)) return;
    const ta = e.currentTarget as HTMLTextAreaElement;
    const caret = ta.selectionStart ?? 0;

    // Ctrl+клик по названию секции — справка (заголовок не содержит jinja, конфликта нет)
    if (helpEnabled) {
      const hit = sectionInsideAt(text, caret);
      if (hit) {
        e.preventDefault();
        void openHelp(hit.name, caretAnchor(ta, caret));
        return;
      }
    }

    const word = wordAt(caret);
    if (!word) return;
    const idx = findDeclaration(word);
    if (idx != null) {
      e.preventDefault();
      jumpToIndex(idx);
    }
  }

  function onPreClick(e: MouseEvent): void {
    // read-only: textarea нет, редактировать нечего — справка открывается обычным кликом
    if (helpEnabled && readonly && !(window.getSelection()?.toString())) {
      const pre = e.currentTarget as HTMLElement;
      const m = readCaretMetrics(pre);
      const rect = pre.getBoundingClientRect();
      const { line, col } = pointToCell(e.clientX, e.clientY, {
        left: rect.left,
        top: rect.top,
        scrollLeft: pre.scrollLeft,
        scrollTop: pre.scrollTop,
        padL: m.padL,
        padT: m.padT,
        charW: m.charW,
        lineH: m.lineH,
      });
      const hit = sectionAtCell(text, line, col);
      if (hit) {
        void openHelp(hit.name, { left: e.clientX, top: e.clientY, bottom: e.clientY + m.lineH });
        return;
      }
    }

    if (!(e.ctrlKey || e.metaKey)) return;
    const v = (e.target as HTMLElement).dataset?.var;
    if (!v) return;
    const idx = findDeclaration(v);
    if (idx != null) jumpToIndex(idx);
  }

  /** Resolve literal macro calls before applying the older section and variable Ctrl+click actions. */
  function onCodeMirrorGesture(position: number, kind: 'peek' | 'open'): boolean {
    const call = macroCallAt(text, position, new Set(macroNames));
    if (call && onLookupMacro) {
      macroLookupError = '';
      const seq = ++macroGestureSeq;
      void onLookupMacro(call.name).then((candidates) => {
        if (seq !== macroGestureSeq) return;
        if (candidates.length === 1) void chooseMacro(candidates[0]!, kind, call.lineEnd);
        else if (candidates.length > 1) candidateChoice = { candidates, kind, lineEnd: call.lineEnd };
      }).catch(() => {
        if (seq === macroGestureSeq) macroLookupError = i18n.t('config.macroLookupError');
      });
      return true;
    }
    if (kind === 'open') return false;
    const section = sectionInsideAt(text, position);
    if (section && helpEnabled && cmView) {
      const box = cmView.coordsAtPos(position);
      if (box) void openHelp(section.name, { left: box.left, top: box.top, bottom: box.bottom });
      return true;
    }
    const word = wordAt(position);
    const declaration = word ? findDeclaration(word) : null;
    if (declaration !== null) { jumpToIndex(declaration); return true; }
    return false;
  }

  /** A peek is a block decoration; its edits remain in the target file's session buffer. */
  async function chooseMacro(definition: MacroDefinition, kind: 'peek' | 'open', lineEnd: number): Promise<void> {
    candidateChoice = null;
    peek?.onCommit?.();
    peek = null;
    if (kind === 'open') {
      try { await onMacroNavigate?.(definition); }
      catch { macroLookupError = i18n.t('config.macroFileError'); }
      return;
    }
    const source = definition.path === filePath ? text : onMacroSource?.(definition.path);
    if (source == null) { macroLookupError = i18n.t('config.macroFileError'); return; }
    const section = source.slice(definition.from, definition.to);
    pendingPeekText = null;
    const commitPeek = (): void => {
      if (pendingPeekText === null) return;
      if (definition.path === filePath) {
        const edit = macroSectionEdit(text, definition, pendingPeekText);
        if (edit) replaceRange(edit.from, edit.to, edit.insert, false);
      } else onPeekEdit?.(definition, pendingPeekText);
      pendingPeekText = null;
    };
    peek = {
      lineEnd, firstLine: definition.firstLine, title: definition.name,
      detail: `${definition.path}:${definition.firstLine}-${definition.lastLine}${definition.active ? '' : ` · ${i18n.t('config.macroInactive')}`}`,
      section,
      saveLabel: i18n.t('ft.save'), openLabel: i18n.t('config.macroOpenFile'), closeLabel: i18n.t('ft.close'),
      onChange: (updated) => {
        if (peek) peek.section = updated;
        // One commit on blur keeps the nested editor mounted and creates one undo step.
        pendingPeekText = updated;
      },
      onSave: () => {
        commitPeek();
        if (definition.path === filePath) void save();
        else void onPeekSave?.(definition).then((saved) => {
          if (!saved) macroLookupError = i18n.t('config.macroFileError');
        }).catch(() => { macroLookupError = i18n.t('config.macroFileError'); });
      },
      onOpen: () => {
        commitPeek();
        void onMacroNavigate?.(definition).catch(() => { macroLookupError = i18n.t('config.macroFileError'); });
      },
      onClose: () => { commitPeek(); peek = null; requestAnimationFrame(() => cmView?.focus()); },
      onCommit: commitPeek,
      onAttach: (sync) => { syncPeekSection = sync; },
    };
    // Wait until the choice button is removed before restoring a keyboard target inside the dialog.
    await tick();
    cmView?.focus();
  }

  $effect(() => {
    if (!peek || !syncPeekSection || !filePath) return;
    const definition = scanMacroDefinitions(text, filePath).find((item) =>
      item.name === peek!.title && item.firstLine === peek!.firstLine);
    if (definition) syncPeekSection(text.slice(definition.from, definition.to));
  });

  $effect(() => {
    if (!cmView || !jumpLine) return;
    requestAnimationFrame(() => {
      if (!cmView) return;
      const line = cmView.state.doc.line(Math.min(jumpLine, cmView.state.doc.lines));
      cmView.dispatch({ selection: { anchor: line.from }, scrollIntoView: true });
    });
  });
</script>

{#if open}
  <div
    class="editor-overlay"
    class:narrow
    class:embedded
    data-hotkey-editor-owner={api.pluginId}
    style={lang === 'klipper' ? colorStyle : undefined}
    onkeydown={onKeydown}
    role={embedded ? undefined : 'dialog'}
    aria-modal={embedded ? undefined : 'true'}
  >
    <div class="editor-header" dir={uiDir}>
      <!-- The filename has its own column so tool wrapping cannot push it around. -->
      <div class="editor-file-column">
        <span class="editor-title" dir="ltr" title={title}>{title}</span>
        {#if readonly}<span class="ro-badge">{i18n.t('ft.readonly')}</span>{/if}
      </div>
      <div class="editor-main-actions">

      {#if lang === 'klipper'}
        <div class="hl-wrap" class:embedded>
          {#if !embedded}
          <button
            class="btn icon"
            class:active={colorsOpen}
            title={i18n.t('ft.hl.title')}
            aria-label={i18n.t('ft.hl.title')}
            onclick={(event) => toggleColors(event.currentTarget)}
          >
            <Icon name="settings" size={15} />
            {#if !narrow}<span class="btn-label">{i18n.t('ft.lbl.colors')}</span>{/if}
          </button>
          {/if}

          {#if colorsOpen}
            <div class="hl-backdrop" onclick={() => (colorsOpen = false)} role="presentation"></div>
            <div class="hl-popover" dir={uiDir} style:inset-block-start={`${colorsPosition.top}px`}
              style:inset-inline-start={`${colorsPosition.start}px`}
              style:max-block-size={`calc(100dvh - ${colorsPosition.top + 8}px)`}>
              <div class="hl-head">
                <span class="hl-title">
                  {i18n.t('ft.hl.title')} · {i18n.t(hostTheme === 'dark' ? 'ft.hl.themeDark' : 'ft.hl.themeLight')}
                </span>
                <button class="sb-btn text" onclick={() => resetTheme(hostTheme)}>
                  {i18n.t('ft.hl.resetAll')}
                </button>
              </div>
              <div class="hl-list">
                {#each TOKEN_KEYS as key (key)}
                  <div class="hl-row">
                    <span class="hl-name" style:color={effectiveColor(hostTheme, overrides, key)}>
                      {i18n.t(`ft.hl.tok.${key}`)}
                    </span>
                    <span class="hl-hex">{effectiveColor(hostTheme, overrides, key)}</span>
                    <ColorPickerMenu
                      value={effectiveColor(hostTheme, overrides, key)}
                      onPick={(hex) => pickColor(key, hex)}
                      i18n={pickerI18n}
                    />
                  </div>
                {/each}
              </div>
            </div>
          {/if}
        </div>

        <div class="hl-wrap">
          <button
            class="btn icon"
            class:active={devicesOpen}
            title={i18n.t('ft.dev.title')}
            aria-label={i18n.t('ft.dev.title')}
            onclick={(event) => toggleDevices(event.currentTarget)}
          >
            <Icon name="plug" size={15} />
            {#if !narrow}<span class="btn-label">{i18n.t('ft.lbl.devices')}</span>{/if}
          </button>

          {#if devicesOpen}
            <div class="hl-backdrop" onclick={closeDevices} role="presentation"></div>
            <div class="hl-popover dev-popover" dir={uiDir} style:inset-block-start={`${devicesPosition.top}px`}
              style:inset-inline-start={`${devicesPosition.start}px`}
              style:max-block-size={`calc(100dvh - ${devicesPosition.top + 8}px)`}>
              <div class="hl-head">
                <span class="hl-title">{i18n.t('ft.dev.title')}</span>
                <button
                  class="sb-btn"
                  title={i18n.t('ft.dev.refresh')}
                  disabled={devTab === 'canbus' && !canInterfaceOk}
                  onclick={() => loadTab(devTab)}
                >
                  <Icon name="refresh" size={14} />
                </button>
              </div>

              <div class="dev-tabs" role="tablist">
                {#each DEVICE_KINDS as kind (kind)}
                  <button
                    class="dev-tab"
                    class:active={devTab === kind}
                    role="tab"
                    aria-selected={devTab === kind}
                    onclick={() => selectDevTab(kind)}
                  >
                    {i18n.t(`ft.dev.tab.${kind}`)}{devState[kind].status === 'ready'
                      ? ` (${devState[kind].cards.length})`
                      : ''}
                  </button>
                {/each}
              </div>

              {#if devTab === 'canbus'}
                <div class="dev-can">
                  <label class="dev-can-label" for="dev-can-if">{i18n.t('ft.dev.interface')}</label>
                  <input
                    id="dev-can-if"
                    class="sb-input dev-can-input"
                    class:invalid={!canInterfaceOk}
                    bind:value={canInterface}
                    spellcheck="false"
                    onkeydown={(e) => {
                      e.stopPropagation();
                      if (e.key === 'Escape') closeDevices();
                      else if (e.key === 'Enter' && canInterfaceOk) loadTab('canbus');
                    }}
                  />
                  <button
                    class="btn"
                    disabled={!canInterfaceOk || devState.canbus.status === 'loading'}
                    onclick={() => loadTab('canbus')}
                  >
                    {i18n.t('ft.dev.scan')}
                  </button>
                </div>
              {/if}

              <div class="hl-list dev-list">
                {#if devState[devTab].status === 'loading'}
                  <div class="dev-state">
                    <Loader inline text={i18n.t('ft.loading')} />
                  </div>
                {:else if devState[devTab].status === 'idle'}
                  <div class="dev-state">{i18n.t('ft.dev.canHint')}</div>
                {:else if devState[devTab].status === 'ready'}
                  {#each devState[devTab].cards as card (card.id)}
                    <div class="dev-card">
                      <div class="dev-card-title" dir="ltr">{card.title}</div>
                      {#if card.subtitle}
                        <div class="dev-card-sub" dir="ltr">{card.subtitle}</div>
                      {/if}
                      {#each card.fields as f (f.key)}
                        {@const fk = `${card.id}:${f.key}`}
                        <div class="dev-field">
                          <span class="dev-key">{f.key}</span>
                          <span class="dev-val" dir="ltr">{f.value}</span>
                          {#if f.copyable}
                            <button
                              class="sb-btn"
                              class:ok={copiedKey === fk}
                              title={i18n.t(copiedKey === fk ? 'ft.dev.copied' : 'ft.dev.copy')}
                              onclick={() => copyValue(fk, f.value)}
                            >
                              {#if copiedKey === fk}✓{:else}<Icon name="copy" size={13} />{/if}
                            </button>
                            {#if canInsert}
                              <button
                                class="sb-btn"
                                title={i18n.t('ft.dev.insert')}
                                onclick={() => insertDeviceValue(f.value)}
                              >
                                <Icon name="playlist-plus" size={13} />
                              </button>
                            {/if}
                          {/if}
                        </div>
                      {/each}
                    </div>
                  {:else}
                    <div class="dev-state">{i18n.t('ft.dev.empty')}</div>
                  {/each}
                {:else if devState[devTab].status === 'unsupported'}
                  <div class="dev-state">{i18n.t('ft.dev.unsupported')}</div>
                {:else}
                  <div class="dev-state">
                    <span>
                      {devState[devTab].status === 'offline'
                        ? i18n.t('ft.dev.offline')
                        : i18n.t('ft.dev.error')}
                    </span>
                    {#if devState[devTab].status === 'error' && devState[devTab].error}
                      <span class="dev-err" dir="ltr">{devState[devTab].error}</span>
                    {/if}
                    <button class="btn" onclick={() => loadTab(devTab)}>{i18n.t('ft.dev.retry')}</button>
                  </div>
                {/if}
              </div>
            </div>
          {/if}
        </div>

        <button
          class="btn icon"
          class:active={tocVisible}
          title={i18n.t('ft.toc')}
          aria-label={i18n.t('ft.toc')}
          onclick={toggleToc}
        >
          <Icon name="rows" size={15} />
          {#if !narrow}<span class="btn-label">{i18n.t('ft.toc')}</span>{/if}
        </button>
        {#if useCodeMirror && !readonly && builderActions.length > 0}
          <!-- The icon stays accessible when labels collapse on narrow viewports. -->
          <button class="btn icon" title={i18n.t('config.macroBuilder')} aria-label={i18n.t('config.macroBuilder')}
            disabled={loading || !cmView} onclick={openMacroBuilder}>
            <Icon name="kind-macro" size={15} />
            {#if !narrow}<span class="btn-label">{i18n.t('config.macroBuilder')}</span>{/if}
          </button>
        {/if}
        {#if useCodeMirror}
          <button class="btn icon" title={i18n.t('config.macroPeek')} aria-label={i18n.t('config.macroPeek')}
            onclick={() => cmView && onCodeMirrorGesture(cmView.state.selection.main.head, 'peek')}>
            <Icon name="kind-macro" size={15} />
            {#if !narrow}<span class="btn-label">{i18n.t('config.macroPeek')}</span>{/if}
          </button>
          <button class="btn icon" title={i18n.t('config.macroOpenFile')} aria-label={i18n.t('config.macroOpenFile')}
            onclick={() => cmView && onCodeMirrorGesture(cmView.state.selection.main.head, 'open')}>
            <Icon name="file" size={15} />
            {#if !narrow}<span class="btn-label">{i18n.t('config.macroOpenFile')}</span>{/if}
          </button>
        {/if}
      {/if}

      <button
        class="btn icon"
        class:active={searchOpen}
        title={i18n.t('ft.lbl.search')}
        aria-label={i18n.t('ft.lbl.search')}
        onclick={() => (searchOpen ? closeSearch() : openSearch(false))}
      >
        <Icon name="search" size={15} />
        {#if !narrow}<span class="btn-label">{i18n.t('ft.lbl.search')}</span>{/if}
      </button>

      {#if loadBackup}
        <button
          class="btn icon"
          class:active={compareMode}
          title={i18n.t(compareMode ? 'config.exitCompare' : 'config.compareBackup')}
          aria-label={i18n.t(compareMode ? 'config.exitCompare' : 'config.compareBackup')}
          aria-pressed={compareMode}
          onclick={() => void toggleCompare()}
        >
          <Icon name="columns" size={15} />
          {#if !narrow}<span class="btn-label">{i18n.t(compareMode ? 'config.exitCompare' : 'config.compareBackup')}</span>{/if}
        </button>
        {#if compareMode && compareBackup && !readonly}
          <button
            class="btn"
            title={i18n.t('config.restoreBackup')}
            aria-label={i18n.t('config.restoreBackup')}
            disabled={saving || savePending || text === compareBackup.text}
            onclick={restoreBackupToBuffer}
          >
            <Icon name="refresh" size={15} />
            {#if !narrow}<span class="btn-label">{i18n.t('config.restoreBackup')}</span>{/if}
          </button>
        {/if}
      {/if}

      </div>
      <!-- The save group occupies the inline end independently of the wrapping tools. -->
      <div class="editor-save-actions"
        class:with-restart={!embedded && !readonly && canRestart && (!restartRequired || !restartHidden)}
        class:with-minimize={!embedded && Boolean(onMinimize)}>
      {#if !readonly}
        <button
          class="btn primary save-action"
          title={i18n.t('ft.save')}
          aria-label={i18n.t('ft.save')}
          disabled={loading || saving || savePending || !currentDirty}
          onclick={() => void save()}
        >
          <Icon name="save" size={15} />
          {#if !narrow}<span class="btn-label">{i18n.t('ft.save')}</span>{/if}
        </button>
        {#if !embedded && canRestart && !readonly && (!restartRequired || !restartHidden)}
          {@const actionLabel = restartLabel ??
            (restartKind === 'moonraker' ? i18n.t('ft.saveRestartMk') : i18n.t('ft.saveAllRestart'))}
          <button
            class="btn primary restart-action"
            title={actionLabel}
            aria-label={actionLabel}
            disabled={loading || saving || savePending || !(hasPendingSave || (tabs.length ? tabs.some((tab) => tab.dirty) : currentDirty))}
            onclick={() => void saveRestart()}
          >
            <Icon name="refresh" size={15} />
            {#if !narrow}<span class="btn-label">{actionLabel}</span>{/if}
          </button>
        {/if}
      {/if}
      {#if !embedded && onMinimize}
        <button class="btn minimize-action" title={i18n.t('config.minimizeEditor')}
          aria-label={i18n.t('config.minimizeEditor')}
          onclick={() => { peek?.onCommit?.(); onMinimize?.(); }}>
          <Icon name="chevron-down" size={15} />
          {#if !narrow}<span class="btn-label">{i18n.t('config.minimizeEditor')}</span>{/if}
        </button>
      {/if}
      {#if !embedded}<button
        class="btn close-action"
        title={i18n.t('ft.close')}
        aria-label={i18n.t('ft.close')}
        onclick={requestClose}
      >
        <Icon name="x" size={15} />
        {#if !narrow}<span class="btn-label">{i18n.t('ft.close')}</span>{/if}
      </button>{/if}
      </div>
    </div>

    {#if !embedded && useCodeMirror && tabs.length > 0}
      <!-- File tabs retain independent unsaved buffers when following a macro. -->
      <div class="editor-tabs" role="tablist" dir={uiDir}>
        {#each tabs as tab (tab.id ?? tab.path)}
          <!-- The tab label and close action are siblings so both remain valid buttons. -->
          <div class="editor-tab" class:active={(tab.id ?? tab.path) === (activeTabId ?? filePath)} role="presentation">
            <button class="editor-tab-label" role="tab" aria-selected={(tab.id ?? tab.path) === (activeTabId ?? filePath)}
              title={tab.path} onclick={() => { peek?.onCommit?.(); onSelectTab?.(tab.id ?? tab.path); }}>
              <span dir="ltr">{tab.path}</span>{#if tab.dirty}<span aria-hidden="true"> •</span>{/if}
            </button>
            <button class="editor-tab-close" title={i18n.t('config.closeTab', { file: tab.path })}
              aria-label={i18n.t('config.closeTab', { file: tab.path })}
              disabled={saving || savePending || tabCloseBusy}
              onclick={() => void requestTabClose(tab.id ?? tab.path)}><Icon name="x" size={13} /></button>
          </div>
        {/each}
      </div>
    {/if}

    <div class="editor-body">
      {#if loading}
        <div class="editor-loading">
          <Loader size="lg" text={i18n.t('ft.loading')} />
        </div>
      {:else}
        {#if compareMode && compareBackup && !narrow}
          <div class="compare-headings" dir="ltr">
            <div title={compareBackup.path}>{compareBackup.path}</div>
            <div title={title}>{title}</div>
          </div>
        {/if}
        <div class="code-wrap" class:compare-active={compareMode && !!compareBackup && !narrow} dir="ltr">
          {#if compareMode && compareBackup && !narrow}
            <div class="compare-backup" class:with-actions={!readonly} bind:this={comparePaneEl} aria-label={compareBackup.path}>
              <ConfigCompareView before={compareBackup.text} after={text} {lang} />
            </div>
          {/if}
          {#if compareMode && compareBackup && !readonly}
            <!-- Code panes stay LTR even in RTL UI, so the arrow always points from backup into the editor. -->
            <div class="hunk-rail" aria-label={i18n.t('config.applyBackupHunk')}>
              {#each compareHunks as hunk, index (`${hunk.beforeStart}:${hunk.beforeEnd}:${hunk.afterStart}:${hunk.afterEnd}`)}
                <button
                  class="hunk-action"
                  type="button"
                  title={i18n.t('config.applyBackupHunk')}
                  aria-label={i18n.t('config.applyBackupHunkNumber', { number: index + 1 })}
                  disabled={saving || savePending}
                  style:top="calc(var(--space-md) + {Math.min(hunk.afterStart, lineCount - 1) * 1.5}em - {editorScrollTop}px)"
                  onclick={() => applyBackupHunk(hunk)}
                ><Icon name="chevron-right" size={17} /></button>
              {/each}
            </div>
          {/if}
          {#if !useCodeMirror}
            <!-- The legacy editor owns its gutter; CodeMirror provides a native one for cfg files. -->
            <div class="gutter" style:width="{gutterWidthCh}ch">
              <pre class="gutter-pre" bind:this={gutterPreEl} aria-hidden="true">{gutterText}</pre>
            </div>
          {/if}

          <div class="code-area">
            {#if useCodeMirror}
              <ConfigCodeMirror bind:view={cmView} value={text} {readonly} {peek}
                allowManagedHotkeys={hostManagedHotkeys}
                snapshot={editorSnapshot} onSnapshot={(state) => { if (filePath) onEditorSnapshot?.(filePath, state); }}
                compareMarks={currentLineMarks}
                onChange={(next) => { builderRevision++; text = next; dirty = true; onBufferChange?.(next); scheduleSuggestions(); }}
                onCursor={() => scheduleSuggestions()}
                onGesture={onCodeMirrorGesture}
                onEditorKey={(event) => {
                  if (hostManagedHotkeys) return false;
                  // Other owners keep the modal event inside their editor.
                  event.stopPropagation();
                  onKeydown(event);
                  return event.defaultPrevented;
                }}
                onCompletionKey={onSuggestionKey}
                onScroll={(top) => { editorScrollTop = top; if (comparePaneEl) comparePaneEl.scrollTop = top; }} />
            {:else}
            <!-- цветной слой ПОД textarea -->
            <pre
              class="code-view"
              aria-hidden="true"
              bind:this={preEl}
              onclick={onPreClick}
              onscroll={(e) => {
                if (gutterPreEl) gutterPreEl.scrollTop = (e.currentTarget as HTMLElement).scrollTop;
              }}
            >{@html html}</pre>

            {#if !readonly}
              <!-- The input must receive the buffer itself; the syntax layer only paints behind it. -->
              <textarea
                class="code-input"
                value={text}
                spellcheck="false"
                bind:this={inputEl}
                oninput={onInput}
                onscroll={(e) => { syncScroll(e); closeSuggestions(); }}
                onclick={(e) => { onEditorClick(e); onCursorMove(); }}
                onkeyup={onKeyUp}
                onkeydown={(e) => {
                  if (onSuggestionKey(e.key)) { e.preventDefault(); return; }
                  // The Config host contract receives keys at the dialog root; other owners stay local.
                  if (hostManagedHotkeys) return;
                  e.stopPropagation();
                  onKeydown(e);
                }}
              ></textarea>
            {/if}
            {/if}

            <!-- поиск / замена -->
            {#if searchOpen}
              <div class="search-bar" role="search" dir={uiDir}>
                <div class="sb-row">
                  <input
                    class="sb-input"
                    bind:this={searchInputEl}
                    placeholder={i18n.t('ft.search')}
                    bind:value={query}
                    oninput={() => (matchIdx = -1)}
                    onkeydown={(e) => {
                      e.stopPropagation();
                      if (e.key === 'Escape') {
                        e.preventDefault();
                        closeSearch();
                      } else if (e.key === 'Enter') {
                        e.preventDefault();
                        gotoMatch(matchIdx + (e.shiftKey ? -1 : 1));
                      }
                    }}
                  />
                  <span class="sb-count">
                    {query ? `${matches.length > 0 ? matchIdx + 1 : 0}/${matches.length}` : ''}
                  </span>
                  <button
                    class="sb-btn"
                    class:active={caseSensitive}
                    title={i18n.t('ft.caseSensitive')}
                    onclick={() => {
                      caseSensitive = !caseSensitive;
                      matchIdx = -1;
                    }}
                  >
                    Aa
                  </button>
                  <button class="sb-btn" title={i18n.t('ft.prevMatch')} onclick={() => gotoMatch(matchIdx - 1)}>
                    <Icon name="chevron-up" size={14} />
                  </button>
                  <button class="sb-btn" title={i18n.t('ft.nextMatch')} onclick={() => gotoMatch(matchIdx + 1)}>
                    <Icon name="chevron-down" size={14} />
                  </button>
                  {#if !readonly}
                    <button
                      class="sb-btn"
                      class:active={replaceMode}
                      title={i18n.t('ft.replaceToggle')}
                      onclick={() => (replaceMode = !replaceMode)}
                    >
                      <Icon name="edit" size={14} />
                    </button>
                  {/if}
                  <button class="sb-btn" title={i18n.t('ft.closeSearch')} onclick={closeSearch}>
                    <Icon name="x" size={14} />
                  </button>
                </div>

                {#if replaceMode && !readonly}
                  <div class="sb-row">
                    <input
                      class="sb-input"
                      bind:this={replaceInputEl}
                      placeholder={i18n.t('ft.replace')}
                      bind:value={replaceWith}
                      onkeydown={(e) => {
                        e.stopPropagation();
                        if (e.key === 'Escape') {
                          e.preventDefault();
                          closeSearch();
                        } else if (e.key === 'Enter') {
                          e.preventDefault();
                          replaceCurrent();
                        }
                      }}
                    />
                    <button class="sb-btn text" onclick={replaceCurrent}>
                      {i18n.t('ft.replaceBtn')}
                    </button>
                    <button class="sb-btn text" onclick={replaceAll}>
                      {i18n.t('ft.replaceAll')}
                    </button>
                  </div>
                {/if}
              </div>
            {/if}
          </div>

          <!-- оглавление секций конфига -->
          {#if tocVisible && lang === 'klipper'}
            {#if narrow}
              <div class="toc-backdrop" onclick={() => (tocSheetOpen = false)} role="presentation"></div>
            {/if}
            <nav class="toc" class:sheet={narrow} dir={uiDir}>
              <div class="toc-title">{i18n.t('ft.toc')}</div>
              {#each toc as item, i (i)}
                <div class="toc-row">
                  <button class="toc-item" title={item.name} onclick={() => onTocPick(item.line)}>
                    {item.name}
                  </button>
                  {#if helpEnabled}
                    <button
                      class="toc-help"
                      title={i18n.t('ft.help.open')}
                      aria-label={i18n.t('ft.help.open')}
                      onclick={(e) => onTocHelp(e, item.name)}
                    >
                      ?
                    </button>
                  {/if}
                </div>
              {/each}
            </nav>
          {/if}
        </div>
      {/if}

      {#if compareMode && (compareLoading || compareError || !compareBackup)}
        <div class="compare-message" role={compareError ? 'alert' : 'status'}>
          {compareLoading ? i18n.t('ft.loading') : compareError || i18n.t('config.backupMissing')}
        </div>
      {/if}

      {#if !navigationModifierHeld && acPos && suggestions.length > 0}
        <div class="ac-popup" style="top: {acPos.top}px; left: {acPos.left}px" bind:this={suggestionPopup}>
          {#each suggestions as s, i (s.kind + s.label)}
            <button
              class="ac-item"
              class:selected={i === selectedIdx}
              onmouseenter={() => (selectedIdx = i)}
              onclick={() => acceptSuggestion(s)}
            >
              <span class="ac-kind {s.kind}">{KIND_BADGE[s.kind]}</span>
              <span class="ac-label">{s.label}</span>
              {#if s.detail}<span class="ac-detail">{s.detail}</span>{/if}
            </button>
          {/each}
        </div>
      {/if}
      {#if candidateChoice}
        <div class="macro-choices" role="dialog" aria-label={i18n.t('config.macroChoose')} dir={uiDir}>
          <strong>{i18n.t('config.macroChoose')}</strong>
          {#each candidateChoice.candidates as candidate (`${candidate.path}:${candidate.firstLine}`)}
            <button onclick={() => void chooseMacro(candidate, candidateChoice!.kind, candidateChoice!.lineEnd)}>
              <span dir="ltr">{candidate.path}:{candidate.firstLine}</span>
              {#if !candidate.active}<span>{i18n.t('config.macroInactive')}</span>{/if}
            </button>
          {/each}
          <button onclick={() => (candidateChoice = null)}>{i18n.t('ft.close')}</button>
        </div>
      {/if}
      {#if macroLookupError}<div class="macro-error" role="alert">{macroLookupError}</div>{/if}
      {#if closePrompt}
        <div class="close-prompt-backdrop" role="presentation"></div>
        <div class="close-prompt" role="alertdialog" aria-modal="true" aria-label={i18n.t('config.macroUnsaved')} dir={uiDir}>
          <strong>{i18n.t('config.macroUnsaved')}</strong>
          <div class="close-prompt-actions">
            <button disabled={closeBusy} onclick={() => void saveAllAndClose()}>{i18n.t('config.macroSaveAll')}</button>
            <button disabled={closeBusy} onclick={() => { closePrompt = false; onClose(); }}>{i18n.t('config.macroDiscard')}</button>
            <button disabled={closeBusy} onclick={() => (closePrompt = false)}>{i18n.t('common.cancel')}</button>
          </div>
        </div>
      {/if}
      {#if tabClosePrompt}
        <div class="close-prompt-backdrop" role="presentation"></div>
        <div class="close-prompt" role="alertdialog" aria-modal="true"
          aria-label={i18n.t('config.tabUnsaved', { file: tabClosePrompt })} dir={uiDir}>
          <strong>{i18n.t('config.tabUnsaved', { file: tabClosePrompt })}</strong>
          <div class="close-prompt-actions">
            <button disabled={tabCloseBusy} onclick={() => tabClosePrompt && void confirmTabClose(tabClosePrompt, true)}>{i18n.t('ft.save')}</button>
            <button disabled={tabCloseBusy} onclick={() => tabClosePrompt && void confirmTabClose(tabClosePrompt, false)}>{i18n.t('config.macroDiscard')}</button>
            <button disabled={tabCloseBusy} onclick={() => (tabClosePrompt = null)}>{i18n.t('common.cancel')}</button>
          </div>
        </div>
      {/if}
    </div>

    {#if helpTarget}
      <ConfigHelpPopover
        section={helpTarget.section}
        view={helpView}
        anchor={helpTarget.anchor}
        {narrow}
        dir={uiDir}
        {i18n}
        onClose={closeHelp}
        onRetry={() => helpTarget && openHelp(helpTarget.section, helpTarget.anchor)}
      />
    {/if}
  </div>
{/if}

<style>
  /* Match Config's file-table tabs while keeping a separate touch target for closing. */
  .editor-tabs { display: flex; flex-wrap: wrap; gap: var(--space-md); padding-inline: var(--space-md); background: var(--bg-surface-hover); border-block-end: 1px solid var(--border-color); }
  .editor-tab { display: flex; align-items: stretch; max-inline-size: 100%; min-inline-size: 0; border-block-end: 2px solid transparent; color: var(--text-muted); }
  .editor-tab.active { border-block-end-color: var(--accent); color: var(--accent); }
  .editor-tab-label, .editor-tab-close { min-height: 40px; border: 0; background: transparent; color: inherit; cursor: pointer; }
  .editor-tab-label { display: flex; align-items: center; min-inline-size: 0; padding-inline: var(--space-xs); font-size: var(--font-size-sm); letter-spacing: 0.04em; }
  .editor-tab-label span:first-child { min-inline-size: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .editor-tab-close { display: grid; place-items: center; min-inline-size: 40px; border-radius: var(--radius-sm); }
  .editor-tab:hover { color: var(--text-primary); }
  .editor-tab-close:hover { background: var(--bg-surface-active); }
  .editor-tab-close:disabled { opacity: 0.5; cursor: default; }
  .macro-choices { position: fixed; inset-inline: 0; top: 22%; margin-inline: auto; width: min(90vw, 500px); z-index: 90; display: flex; flex-direction: column; gap: var(--space-xs); max-height: 60vh; overflow: auto; padding: var(--space-md); border: 1px solid var(--border-color); border-radius: var(--radius-md); background: var(--bg-surface); box-shadow: var(--shadow-md); }
  .macro-choices button { min-height: 40px; padding: var(--space-xs) var(--space-sm); border-radius: var(--radius-sm); text-align: start; overflow-wrap: anywhere; border: 1px solid var(--border-color); background: var(--bg-surface-hover); color: var(--text-primary); cursor: pointer; }
  .macro-choices button:hover { background: var(--bg-surface-active); }
  .macro-error { position: fixed; inset-inline: 0; bottom: var(--space-lg); margin-inline: auto; width: min(90vw, 500px); z-index: 100; padding: var(--space-sm); background: var(--bg-surface); color: var(--danger); border: 1px solid var(--danger); }
  .close-prompt-backdrop { position: fixed; inset: 0; z-index: 110; background: var(--bg-overlay); }
  .close-prompt { position: fixed; inset-inline: 0; top: 35%; margin-inline: auto; width: min(90vw, 480px); z-index: 111; display: grid; gap: var(--space-md); padding: var(--space-lg); border: 1px solid var(--border-color); border-radius: var(--radius-md); background: var(--bg-surface); box-shadow: var(--shadow-md); }
  .close-prompt-actions { display: flex; flex-wrap: wrap; gap: var(--space-sm); }
  .close-prompt-actions button { min-height: 40px; padding: var(--space-xs) var(--space-sm); border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: var(--bg-surface-hover); color: var(--text-primary); cursor: pointer; }
  .editor-overlay {
    position: fixed;
    inset: 0;
    z-index: 500;
    display: flex;
    flex-direction: column;
    background: var(--bg-surface);
  }
  /* The Config session owns the modal frame and shared file tabs. */
  .editor-overlay.embedded { position: relative; inset: auto; z-index: auto; flex: 1; min-block-size: 0; min-inline-size: 0; }

  .editor-header {
    display: grid;
    grid-template-columns: minmax(0, max-content) minmax(0, 1fr) max-content;
    align-items: start;
    /* A fixed-width query avoids wrap feedback when either action group changes height. */
    container: editor-header / inline-size;
    gap: var(--space-sm);
    padding: var(--space-sm) var(--space-md);
    border-bottom: 1px solid var(--border-color);
    flex-shrink: 0;
    position: relative;
  }

  /* Size the filename to its text, cap long names, and center it in a taller action row. */
  .editor-file-column { display: flex; align-self: stretch; align-items: center; gap: var(--space-xs); inline-size: max-content; max-inline-size: min(280px, 35vw); min-inline-size: 0; overflow: hidden; }
  .editor-main-actions { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-sm); min-width: 0; }
  /* Grid keeps save actions at inline-end while the other tools wrap independently. */
  .editor-save-actions { display: grid; grid-auto-flow: column; grid-auto-columns: max-content; gap: var(--space-sm); justify-self: end; }
  .editor-save-actions .btn { justify-content: center; white-space: nowrap; }
  @container editor-header (max-width: 1500px) {
    .editor-save-actions.with-restart {
      grid-auto-flow: row;
      grid-template-columns: repeat(2, minmax(max-content, 1fr));
      width: max-content;
    }
    .editor-save-actions.with-restart .save-action { grid-column: 1; grid-row: 1; }
    .editor-save-actions.with-restart .close-action { grid-column: 2; grid-row: 1; }
    .editor-save-actions.with-restart .restart-action { grid-column: 1 / -1; grid-row: 2; }
    /* Config adds a minimize action without changing other shared editors' two-column toolbar. */
    .editor-save-actions.with-restart.with-minimize { grid-template-columns: repeat(3, minmax(max-content, 1fr)); }
    .editor-save-actions.with-restart.with-minimize .minimize-action { grid-column: 2; grid-row: 1; }
    .editor-save-actions.with-restart.with-minimize .close-action { grid-column: 3; grid-row: 1; }
  }
  /* Keep full-width translated tool labels away from the save group near tablet widths. */
  @media (max-width: 1100px) {
    /* The middle track is a spacer, so a short filename does not fill the row. */
    .editor-header { grid-template-columns: minmax(0, max-content) minmax(0, 1fr) max-content; }
    .editor-file-column { grid-column: 1; grid-row: 1; }
    .editor-main-actions { grid-column: 1 / -1; grid-row: 2; }
    .editor-save-actions { grid-column: 3; grid-row: 1; }
  }

  .editor-title {
    flex: 1 1 auto;
    min-width: 0;
    font-family: monospace;
    font-size: var(--font-size-md);
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ro-badge {
    padding: 1px 8px;
    border-radius: 999px;
    background: var(--bg-surface-hover);
    border: 1px solid var(--border-color);
    color: var(--text-muted);
    font-size: var(--font-size-sm);
  }


  .btn {
    display: flex; align-items: center; gap: var(--space-xs);
    padding: var(--space-xs) var(--space-md);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    background: var(--bg-surface-hover);
    color: var(--text-primary);
    font-size: var(--font-size-sm);
    cursor: pointer;
  }
  .btn:hover { background: var(--border-color); }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
  .btn.primary:hover:not(:disabled) { filter: brightness(1.1); }
  .btn.icon.active { background: var(--accent); border-color: var(--accent); color: #fff; }
  .btn-label { white-space: nowrap; }

  .editor-body { flex: 1; min-height: 0; position: relative; }

  .editor-loading {
    position: absolute; inset: 0;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    gap: var(--space-md);
    color: var(--text-muted);
  }
  .compare-message {
    position: absolute;
    inset-block-start: var(--space-sm);
    inset-inline: var(--space-md);
    z-index: 30;
    padding: var(--space-sm) var(--space-md);
    color: var(--text-secondary);
    background: var(--bg-surface-hover);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    text-align: start;
    overflow-wrap: anywhere;
  }

  /* -------- раскладка: гаттер + оглавление + код -------- */
  .code-wrap {
    position: absolute; inset: 0;
    display: flex;
  }
  .code-wrap.compare-active { inset-block-start: 2rem; }
  /* Labels sit outside both scroll areas so their first code lines stay aligned. */
  .compare-headings {
    position: absolute;
    inset-block-start: 0;
    inset-inline: 0;
    height: 2rem;
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    background: var(--bg-surface-hover);
    border-block-end: 1px solid var(--border-color);
  }
  .compare-headings > div {
    min-width: 0;
    padding: var(--space-xs) var(--space-md);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font: var(--font-size-sm) monospace;
  }
  /* The backup takes half the desktop width; mobile keeps the editable file full width. */
  .compare-backup {
    flex: 0 0 50%;
    min-width: 0;
    overflow: auto;
    border-inline-end: 1px solid var(--border-color);
    background: var(--bg-surface);
  }
  .compare-backup.with-actions { flex-basis: calc(50% - 22px); }
  /* A fixed rail keeps touch actions beside the first changed line without replacing the textarea. */
  .hunk-rail {
    position: relative;
    flex: 0 0 44px;
    min-width: 44px;
    overflow: hidden;
    background: var(--bg-surface-hover);
    border-inline-end: 1px solid var(--border-color);
    font-family: monospace;
    font-size: var(--font-size-md);
    line-height: 1.5;
  }
  .hunk-action {
    position: absolute;
    inset-inline: 0;
    width: 44px;
    height: 44px;
    display: grid;
    place-items: center;
    border: 0;
    background: transparent;
    color: var(--accent);
    cursor: pointer;
  }
  .hunk-action:hover, .hunk-action:focus-visible { background: var(--bg-surface); }
  .hunk-action:disabled { opacity: 0.5; cursor: not-allowed; }
  :global(.code-view .compare-line) { display: inline; }
  :global(.code-view .compare-line.added) { background: color-mix(in srgb, var(--success) 18%, var(--bg-surface)); }
  :global(.code-view .compare-line.removed) { background: color-mix(in srgb, var(--danger) 14%, var(--bg-surface)); }
  :global(.code-view .compare-line.changed) { background: color-mix(in srgb, var(--accent) 18%, var(--bg-surface)); }

  .gutter {
    position: relative;
    flex-shrink: 0;
    overflow: hidden;
    background: var(--bg-surface-hover);
    border-right: 1px solid var(--border-color);
  }

  .gutter-pre {
    margin: 0;
    height: 100%;
    overflow: hidden;
    padding: var(--space-md) var(--space-xs);
    font-family: monospace;
    font-size: var(--font-size-md);
    line-height: 1.5;
    color: var(--text-muted);
    text-align: right;
    white-space: pre;
  }

  .toc {
    width: 230px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    background: var(--bg-surface);
    border-left: 1px solid var(--border-color);
    padding: var(--space-xs);
  }

  .toc-title {
    padding: var(--space-xs) var(--space-sm);
    font-size: var(--font-size-xs);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--text-muted);
  }

  .toc-item {
    border: none;
    background: transparent;
    color: var(--text-secondary);
    font-family: monospace;
    font-size: var(--font-size-sm);
    padding: 2px var(--space-sm);
    border-radius: var(--radius-sm);
    text-align: start;
    cursor: pointer;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .toc-item:hover {
    background: var(--bg-surface-hover);
    color: var(--text-primary);
  }

  /* пункт оглавления + кнопка справки «?» справа */
  .toc-row { display: flex; align-items: center; gap: 2px; }
  .toc-row .toc-item { flex: 1; min-width: 0; }

  .toc-help {
    flex-shrink: 0;
    width: 22px;
    height: 22px;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: var(--text-muted);
    font-size: var(--font-size-xs-plus);
    font-weight: 700;
    cursor: pointer;
  }
  .toc-help:hover { background: var(--bg-surface-hover); color: var(--accent); }

  .code-area {
    position: relative;
    flex: 1;
    min-width: 0;
  }

  /* цветной слой ПОД textarea */
  .code-view {
    position: absolute; inset: 0;
    margin: 0;
    padding: var(--space-md);
    overflow: auto;
    font-family: monospace;
    font-size: var(--font-size-md);
    line-height: 1.5;
    white-space: pre;
    color: var(--text-primary);
    background: var(--bg-surface);
  }

  /* прозрачный текст, видна только каретка; лежит СВЕРХУ */
  .code-input {
    position: absolute; inset: 0;
    width: 100%; height: 100%;
    resize: none;
    border: none;
    outline: none;
    background: transparent;
    color: transparent;
    caret-color: var(--text-primary);
    font-family: monospace;
    font-size: var(--font-size-md);
    line-height: 1.5;
    padding: var(--space-md);
    white-space: pre;
    overflow: auto;
  }

  .code-view, .code-input, .gutter-pre {
    tab-size: 4;
    -moz-tab-size: 4;
  }
  .code-input::selection { background: rgba(78, 161, 255, 0.35); color: transparent; }

  /* -------- панель поиска/замены -------- */
  .search-bar {
    position: absolute;
    top: var(--space-sm);
    right: var(--space-md);
    z-index: 20;
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
    padding: var(--space-xs);
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-md);
  }

  .sb-row {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  .sb-input {
    width: 200px;
    padding: 3px var(--space-xs);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    background: var(--bg-app, var(--bg-surface-hover));
    color: var(--text-primary);
    font-family: monospace;
    font-size: var(--font-size-sm);
  }

  .sb-input:focus {
    outline: none;
    border-color: var(--border-focus, var(--accent));
  }

  .sb-count {
    min-width: 52px;
    text-align: center;
    font-family: monospace;
    font-size: var(--font-size-xs);
    color: var(--text-muted);
    flex-shrink: 0;
  }

  .sb-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-muted);
    font-size: var(--font-size-xs);
    font-weight: 700;
    cursor: pointer;
    flex-shrink: 0;
  }

  .sb-btn:hover { background: var(--bg-surface-hover); color: var(--text-primary); }
  .sb-btn.active { background: var(--bg-surface-active); color: var(--accent); }

  .sb-btn.text {
    width: auto;
    padding: 0 var(--space-sm);
    font-size: var(--font-size-sm);
    font-weight: 500;
  }

  .ac-popup {
    position: fixed;
    z-index: 600;
    min-width: 200px;
    max-width: min(520px, calc(100vw - 8px));
    max-height: 280px;
    overflow-y: auto;
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    box-shadow: var(--shadow-lg);
    font-family: monospace;
    font-size: var(--font-size-sm);
  }

  .ac-item {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    width: 100%;
    padding: var(--space-xs) var(--space-sm);
    border: none;
    background: transparent;
    color: var(--text-primary);
    text-align: start;
    cursor: pointer;
  }

  .ac-item:hover,
  .ac-item.selected {
    background: var(--bg-surface-hover);
  }

  .ac-kind {
    flex-shrink: 0;
    width: 18px;
    height: 18px;
    border-radius: var(--radius-xs, 3px);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: var(--font-size-xs);
    font-weight: 600;
    color: #fff;
    background: var(--text-muted);
  }

  .ac-kind.word { background: #7f848e; }
  .ac-kind.var { background: #61afef; }
  .ac-kind.cmd { background: #e06c75; }
  .ac-kind.macro { background: #c678dd; }
  .ac-kind.param { background: #98c379; }
  .ac-kind.value { background: #d19a66; }

  .ac-label {
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ac-detail {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-muted);
    font-size: var(--font-size-xs);
  }

  /* -------- настройка цветов подсветки -------- */
  .hl-wrap { position: relative; display: flex; }
  /* Settings lives in the session shell, so its fixed menu must not leave a tool gap. */
  .hl-wrap.embedded { display: contents; }

  .hl-backdrop {
    position: fixed;
    inset: 0;
    z-index: 25;
    background: transparent;
  }

  .hl-popover {
    position: fixed;
    z-index: 30;
    width: min(300px, calc(100vw - 16px));
    display: flex;
    flex-direction: column;
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-lg);
  }

  .hl-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-sm);
    padding: var(--space-xs) var(--space-sm);
    border-bottom: 1px solid var(--border-color);
  }

  .hl-title {
    font-size: var(--font-size-xs);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--text-muted);
  }

  .hl-list { overflow-y: auto; padding: var(--space-xs); }

  .hl-row {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    padding: 0 var(--space-xs);
    border-radius: var(--radius-sm);
  }
  .hl-row:hover { background: var(--bg-surface-hover); }

  .hl-name {
    flex: 1;
    min-width: 0;
    font-family: monospace;
    font-size: var(--font-size-sm);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .hl-hex {
    font-family: monospace;
    font-size: var(--font-size-xs);
    color: var(--text-muted);
  }

  /* -------- подключённые устройства -------- */
  .dev-popover { width: min(460px, calc(100vw - 16px)); }

  .dev-tabs {
    display: flex;
    gap: 2px;
    padding: var(--space-xs) var(--space-xs) 0;
    border-bottom: 1px solid var(--border-color);
  }

  .dev-tab {
    padding: var(--space-xs) var(--space-sm);
    border: none;
    border-bottom: 2px solid transparent;
    background: transparent;
    color: var(--text-muted);
    font-size: var(--font-size-sm);
    cursor: pointer;
  }
  .dev-tab:hover { color: var(--text-primary); }
  .dev-tab.active { color: var(--accent); border-bottom-color: var(--accent); }

  .dev-can {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    padding: var(--space-xs) var(--space-sm);
    border-bottom: 1px solid var(--border-color);
  }
  .dev-can-label { font-size: var(--font-size-sm); color: var(--text-muted); }
  .dev-can-input { width: 110px; }
  .dev-can-input.invalid { border-color: var(--danger); }

  .dev-list { display: flex; flex-direction: column; gap: var(--space-xs); }

  .dev-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-sm);
    padding: var(--space-lg, 24px) var(--space-md);
    color: var(--text-muted);
    font-size: var(--font-size-sm);
    text-align: center;
  }
  .dev-err { font-family: monospace; font-size: var(--font-size-xs); word-break: break-word; }

  .dev-card {
    padding: var(--space-xs) var(--space-sm);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
  }
  .dev-card-title {
    font-family: monospace;
    font-size: var(--font-size-sm);
    font-weight: 600;
    color: var(--text-primary);
    word-break: break-all;
  }
  .dev-card-sub {
    margin-bottom: var(--space-xs);
    font-size: var(--font-size-xs);
    color: var(--text-muted);
    word-break: break-word;
  }

  .dev-field {
    display: flex;
    align-items: flex-start;
    gap: var(--space-xs);
    padding: 1px 0;
  }
  .dev-field:hover { background: var(--bg-surface-hover); }
  .dev-key {
    flex: 0 0 110px;
    font-family: monospace;
    font-size: var(--font-size-xs);
    color: var(--text-muted);
    overflow-wrap: anywhere;
  }
  .dev-val {
    flex: 1;
    min-width: 0;
    font-family: monospace;
    font-size: var(--font-size-sm);
    color: var(--text-primary);
    word-break: break-all;
  }
  .dev-field .sb-btn { width: 22px; height: 22px; }
  .sb-btn.ok { color: var(--success, var(--accent)); }

  /* -------- оглавление шторкой поверх редактора (узкий экран) -------- */
  .toc-backdrop {
    position: absolute;
    inset: 0;
    z-index: 21;
    background: rgba(0, 0, 0, 0.35);
  }

  .toc.sheet {
    position: absolute;
    top: 0;
    bottom: 0;
    right: 0;
    z-index: 22;
    width: min(86vw, 320px);
    box-shadow: var(--shadow-lg);
  }

  /* -------- узкий экран: кнопки только с иконками, поповеры на всю ширину -------- */
  .editor-overlay.narrow .editor-header {
    grid-template-columns: minmax(0, max-content) minmax(0, 1fr) max-content;
    gap: var(--space-xs);
    padding: var(--space-xs) var(--space-sm);
  }
  .editor-overlay.narrow .editor-file-column { grid-column: 1; grid-row: 1; }
  .editor-overlay.narrow .editor-main-actions { grid-column: 1 / -1; grid-row: 2; gap: var(--space-xs); }
  /* Keep the three icon actions on the first row at inline-end, including in RTL. */
  .editor-overlay.narrow .editor-save-actions { grid-column: 3; grid-row: 1; grid-template-columns: none; grid-auto-flow: column; grid-auto-columns: 44px; gap: var(--space-xs); width: auto; }
  .editor-overlay.narrow .editor-save-actions > .btn { grid-column: auto; grid-row: auto; }
  .editor-overlay.narrow .btn { min-width: 44px; min-height: 44px; justify-content: center; padding: var(--space-xs); }
  .editor-overlay.narrow .editor-tab-label, .editor-overlay.narrow .editor-tab-close { min-height: 44px; }

  /* Fixed popovers use the same viewport clamp on narrow screens. */
  .editor-overlay.narrow .dev-key { flex-basis: 84px; }

  .editor-overlay.narrow .search-bar {
    left: var(--space-sm);
    right: var(--space-sm);
  }
  .editor-overlay.narrow .sb-input {
    flex: 1;
    width: auto;
    min-width: 0;
  }
  .editor-overlay.narrow .sb-count { min-width: 40px; }

  /* цвета приходят из --tok-*, которые диалог выставляет на .editor-overlay */
  :global(.tok-section) { color: var(--tok-section); }
  :global(.tok-driver) { color: var(--tok-driver); }
  :global(.tok-pin) { color: var(--tok-pin); }
  :global(.tok-num) { color: var(--tok-num); }
  :global(.tok-comment) { color: var(--tok-comment); font-style: italic; }
  :global(.tok-save-mark) { color: var(--tok-save-mark); font-weight: 600; }
  :global(.tok-cmd) { color: var(--tok-cmd); }
  :global(.tok-ext) { color: var(--tok-ext); }
  :global(.tok-axis) { color: var(--tok-axis); }
  :global(.tok-param) { color: var(--tok-param); }
  :global(.tok-str) { color: var(--tok-str); }
  :global(.tok-jinja) { color: var(--tok-jinja); }
  :global(.tok-jinja-kw) { color: var(--tok-jinja-kw); }
  :global(.tok-jinja-var) { color: var(--tok-jinja-var); }
  :global(.tok-filter) { color: var(--tok-filter); }
</style>
