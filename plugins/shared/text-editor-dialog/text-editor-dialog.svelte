<script lang="ts">
  import { untrack } from 'svelte';
  import { usePluginApi } from '../../../plugin-sdk/src/svelte/index';

  import { useKlippyState } from '../klippy-state/use-klippy-state.svelte.ts';
  import { editorUi } from './editor-state.svelte.ts';

  import Icon from '../icons/Icon.svelte';
  import { highlightKlipperLines, highlightPlainLines, toRenderLines } from './highlight';
  import { caretLineCol } from './caret';

  import {
    collectAllWords,
    collectJinjaVars,
    getCompletionContext,
    getSuggestions,
    type Suggestion,
  } from './autocomplete';

  let {
    open,
    title,
    loading = false,
    content,
    readonly = false,
    canRestart = false,
    restartKind = 'klipper',
    lang = 'plain',
    onSave,
    onSaveRestart,
    onClose,
  }: {
    open: boolean;
    title: string;
    loading?: boolean;
    content: string;
    readonly?: boolean;
    canRestart?: boolean;
    restartKind?: 'klipper' | 'moonraker';
    lang?: 'klipper' | 'plain';
    onSave: (text: string) => void;
    onSaveRestart?: (text: string) => void;
    onClose: () => void;
  } = $props();

  const api = usePluginApi();
  const i18n = api.i18n;

  let text = $state('');
  let dirty = $state(false);
  let savePending = $state(false);
  let savePendingTimer: ReturnType<typeof setTimeout> | null = null;
  let printing = $state(false);

  const klippy = useKlippyState(api);
  let restartHidden = $derived(printing && klippy.ready);

  let suggestions = $state<Suggestion[]>([]);
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
  let gcodeCommands = $state<string[]>([]);

  // список gcode-команд берём у Moonraker на каждое открытие редактора
  $effect(() => {
    if (!open) return;
    let cancelled = false;

    api
      .moonraker()
      .request<Record<string, string>>('printer.gcode.help')
      .then((help) => {
        if (cancelled) return;
        gcodeCommands = Object.keys(help ?? {}).sort();
      })
      .catch(() => {
        // offline / метод недоступен — просто нет cmd-подсказок,
        // общие слова файла продолжают работать
      });

    return () => {
      cancelled = true;
    };
  });

  let preEl = $state<HTMLPreElement | null>(null);
  let inputEl = $state<HTMLTextAreaElement | null>(null);
  let gutterPreEl = $state<HTMLPreElement | null>(null);
  let searchInputEl = $state<HTMLInputElement | null>(null);
  let replaceInputEl = $state<HTMLInputElement | null>(null);

  // Textarea прозрачный, текст виден ТОЛЬКО через слой подсветки, поэтому слой обязан
  // обновляться синхронно с вводом. Один {@html} целиком — намеренно: браузер вставляет
  // готовый HTML нативно и быстрее, чем Svelte обслуживает по блоку на каждую из
  // строк ({#each} + {@html} на строку заметно тормозил набор).
  // + zero-width space на пустой последней строке (см. toRenderLines в highlight.ts).
  let html = $derived(
    toRenderLines(
      lang === 'klipper' ? highlightKlipperLines(text) : highlightPlainLines(text),
      text,
    ).join(''),
  );

  $effect(() => {
      void content;
      void loading;
      const norm = content.replace(/\r\n?/g, '\n');
      // Пока savePending — не перезаписываем text из пропа, даже если dirty=false
      if (open && !dirty && !savePending && text !== norm) {
          text = norm;
          if (inputEl && inputEl.value !== norm) inputEl.value = norm;
      }
      // Проп догнал text — считаем сохранение подтверждённым
      if (savePending && text === norm) {
          savePending = false;
          dirty = false;
          if (savePendingTimer) {
              clearTimeout(savePendingTimer);
              savePendingTimer = null;
          }
      }
  });

  $effect(() => {
    if (!open) return;
    return api.moonraker().subscribe(
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
      if (!mod) return;

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
        if (dirty && !savePending) save();
        return;
      }
    }

    window.addEventListener('keydown', onWindowKey, true); // capture: раньше браузера
    return () => window.removeEventListener('keydown', onWindowKey, true);
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
    for (let i = 1; i <= lineCount; i++) s += `${i}\n`;
    return s;
  });

  // ширина гаттера в ch: цифры + отступ; моноширинный шрифт → ch точен
  let gutterWidthCh = $derived(String(lineCount).length + 3);

  // ------------------------------------------------------------------
  // Оглавление секций (только lang=klipper)
  // ------------------------------------------------------------------

  let tocOpen = $state(true);

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

  function jumpToLine(line: number): void {
    const lines = text.split('\n');
    let idx = 0;
    for (let i = 0; i < line && i < lines.length; i++) idx += (lines[i] ?? '').length + 1;
    jumpToIndex(idx);
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
  }

  function setScrollTop(top: number): void {
    if (preEl) preEl.scrollTop = top;
    if (inputEl) inputEl.scrollTop = top;
    if (gutterPreEl) gutterPreEl.scrollTop = top;
  }

  function scrollToShow(idx: number): void {
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
  function replaceRange(start: number, end: number, insert: string): void {
    const ta = inputEl;
    if (!ta) return;
    ta.focus();
    ta.setSelectionRange(start, end);

    const ok = document.execCommand('insertText', false, insert);
    if (!ok) {
      // редкий fallback (execCommand недоступен): undo для этой правки не будет
      text = text.slice(0, start) + insert + text.slice(end);
      dirty = true;
    }
  }

  function onInput(e: Event): void {
    text = (e.currentTarget as HTMLTextAreaElement).value;
    dirty = true;
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
    suggestTimer = setTimeout(() => {
      suggestTimer = null;
      updateSuggestions();
    }, SUGGEST_DELAY_MS);
  }

  $effect(() => () => {
    if (suggestTimer) clearTimeout(suggestTimer);
  });

  function save(): void {
      savePending = true;
      if (savePendingTimer) clearTimeout(savePendingTimer);
      savePendingTimer = setTimeout(() => {
          // страховка: если проп не догнал за 5с, отпускаем
          savePending = false;
          dirty = false;
      }, 5000);
      onSave(text);
      // dirty НЕ сбрасываем здесь — сбросится когда проп догонит
  }

  function saveRestart(): void {
      savePending = true;
      if (savePendingTimer) clearTimeout(savePendingTimer);
      savePendingTimer = setTimeout(() => {
          savePending = false;
          dirty = false;
      }, 5000);
      onSaveRestart?.(text);
  }

  const INDENT = '    '; // 4 пробела

  function onKeydown(e: KeyboardEvent): void {
    // поиск/замена перехватываются раньше Escape-логики редактора
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      openSearch(false);
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'h') {
      e.preventDefault();
      openSearch(true);
      return;
    }

    if (e.key === 'Escape') {
      e.stopPropagation();
      // первый Escape закрывает поиск, второй — редактор
      if (searchOpen) {
        closeSearch();
        return;
      }
      onClose();
      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      // не вызываем save, если ничего не меняли — иначе триггерится
      // родительский onSave и может включиться браузерное сохранение
      if (!readonly && dirty) save();
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
  }

  /** Пересчитать подсказки по текущему положению курсора. */
  function updateSuggestions(): void {
    if (!inputEl) {
      suggestions = [];
      acPos = null;
      return;
    }
    const cursor = inputEl.selectionStart ?? 0;
    const ctx = getCompletionContext(text, cursor);
    if (!ctx) {
      suggestions = [];
      acPos = null;
      return;
    }
    const items = getSuggestions(ctx, { jinjaVars, allWords, gcodeCommands });
    if (items.length === 0) {
      suggestions = [];
      acPos = null;
      return;
    }
    suggestions = items;
    selectedIdx = Math.min(selectedIdx, items.length - 1);
    acPos = computePopupPos(inputEl, cursor, items.length);
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

  function readCaretMetrics(ta: HTMLTextAreaElement): CaretMetrics {
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
    left = Math.max(4, Math.min(left, window.innerWidth - 424));

    return { top, left };
  }

  function acceptSuggestion(s: Suggestion): void {
    if (!inputEl) return;
    const cursor = inputEl.selectionStart ?? 0;
    const ctx = getCompletionContext(text, cursor);
    if (!ctx) return;

    replaceRange(ctx.start, ctx.end, s.insert);
    suggestions = [];
    acPos = null;

    requestAnimationFrame(() => {
      if (!inputEl) return;
      inputEl.selectionStart = inputEl.selectionEnd = ctx.start + s.insert.length;
      inputEl.focus();
    });
  }

  function closeSuggestions(): void {
    suggestions = [];
    acPos = null;
  }

  function onSuggestionKey(e: KeyboardEvent): boolean {
    if (suggestions.length === 0) return false;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedIdx = (selectedIdx + 1) % suggestions.length;
      return true;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedIdx = (selectedIdx - 1 + suggestions.length) % suggestions.length;
      return true;
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      acceptSuggestion(suggestions[selectedIdx]!);
      return true;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      closeSuggestions();
      return true;
    }
    return false;
  }

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

  function jumpToIndex(idx: number): void {
    const line = text.slice(0, idx).split('\n').length - 1;
    const top = Math.max(0, line * lineHeightPx() - lineHeightPx() * 3);
    setScrollTop(top);
    if (inputEl) {
      inputEl.focus();
      inputEl.setSelectionRange(idx, idx);
    }
  }

  function onEditorClick(e: MouseEvent): void {
    if (!(e.ctrlKey || e.metaKey)) return;
    const word = wordAt((e.currentTarget as HTMLTextAreaElement).selectionStart ?? 0);
    if (!word) return;
    const idx = findDeclaration(word);
    if (idx != null) {
      e.preventDefault();
      jumpToIndex(idx);
    }
  }

  function onPreClick(e: MouseEvent): void {
    if (!(e.ctrlKey || e.metaKey)) return;
    const v = (e.target as HTMLElement).dataset?.var;
    if (!v) return;
    const idx = findDeclaration(v);
    if (idx != null) jumpToIndex(idx);
  }
</script>

{#if open}
  <div class="editor-overlay" onkeydown={onKeydown} role="dialog" aria-modal="true">
    <div class="editor-header">
      <span class="editor-title">{title}</span>
      {#if readonly}<span class="ro-badge">{i18n.t('ft.readonly')}</span>{/if}
      <span class="spacer"></span>

      {#if lang === 'klipper'}
        <button
          class="btn icon"
          class:active={tocOpen}
          title={i18n.t('ft.toc')}
          onclick={() => (tocOpen = !tocOpen)}
        >
          <Icon name="rows" size={15} />
        </button>
      {/if}

      <button
        class="btn icon"
        class:active={searchOpen}
        title={i18n.t('ft.search')}
        onclick={() => (searchOpen ? closeSearch() : openSearch(false))}
      >
        <Icon name="search" size={15} />
      </button>

      {#if !readonly}
        <button class="btn primary" disabled={loading || !dirty} onclick={save}>
          <Icon name="save" size={15} />
          {i18n.t('ft.save')}
        </button>
        {#if canRestart && !readonly && !restartHidden}
          <button class="btn primary" disabled={loading || !dirty} onclick={saveRestart}>
            <Icon name="refresh" size={15} />
            {restartKind === 'moonraker' ? i18n.t('ft.saveRestartMk') : i18n.t('ft.saveRestart')}
          </button>
        {/if}
      {/if}
      <button class="btn" onclick={onClose}>
        <Icon name="x" size={15} />
        {i18n.t('ft.close')}
      </button>
    </div>

    <div class="editor-body">
      {#if loading}
        <div class="editor-loading">
          <span class="spinner"></span>
          <span class="loading-text">{i18n.t('ft.loading')}</span>
        </div>
      {:else}
        <div class="code-wrap" dir="ltr">
          <!-- нумерация строк -->
          <div class="gutter" style:width="{gutterWidthCh}ch">
            <pre class="gutter-pre" bind:this={gutterPreEl} aria-hidden="true">{gutterText}</pre>
          </div>

          <div class="code-area">
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
              <textarea
                class="code-input"
                spellcheck="false"
                bind:this={inputEl}
                oninput={onInput}
                onscroll={(e) => { syncScroll(e); closeSuggestions(); }}
                onclick={(e) => { onEditorClick(e); onCursorMove(); }}
                onkeyup={onKeyUp}
                onkeydown={(e) => {
                  // не пускаем событие наверх: overlay-обработчик иначе
                  // выполнит onKeydown второй раз (двойные скобки/табы/save)
                  e.stopPropagation();
                  if (onSuggestionKey(e)) return;
                  onKeydown(e);
                }}
              ></textarea>
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
          {#if tocOpen && lang === 'klipper'}
            <nav class="toc" dir={uiDir}>
              <div class="toc-title">{i18n.t('ft.toc')}</div>
              {#each toc as item, i (i)}
                <button class="toc-item" title={item.name} onclick={() => jumpToLine(item.line)}>
                  {item.name}
                </button>
              {/each}
            </nav>
          {/if}
        </div>
      {/if}

      {#if acPos && suggestions.length > 0}
        <div class="ac-popup" style="top: {acPos.top}px; left: {acPos.left}px">
          {#each suggestions as s, i (s.label)}
            <button
              class="ac-item"
              class:selected={i === selectedIdx}
              onmouseenter={() => (selectedIdx = i)}
              onclick={() => acceptSuggestion(s)}
            >
              <span class="ac-kind" class:var={s.kind === 'var'} class:cmd={s.kind === 'cmd'} class:word={s.kind === 'word'}>
                {s.kind === 'var' ? 'v' : s.kind === 'cmd' ? 'G' : 'w'}
              </span>
              <span class="ac-label">{s.label}</span>
            </button>
          {/each}
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .editor-overlay {
    position: fixed;
    inset: 0;
    z-index: 500;
    display: flex;
    flex-direction: column;
    background: var(--bg-surface);
  }

  .editor-header {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    padding: var(--space-sm) var(--space-md);
    border-bottom: 1px solid var(--border-color);
    flex-shrink: 0;
  }

  .editor-title {
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

  .spacer { flex: 1; }

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
  .btn.icon { padding: var(--space-xs); }
  .btn.icon.active { background: var(--accent); border-color: var(--accent); color: #fff; }

  .editor-body { flex: 1; min-height: 0; position: relative; }

  .editor-loading {
    position: absolute; inset: 0;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    gap: var(--space-md);
    color: var(--text-muted);
  }
  .spinner {
    width: 28px; height: 28px;
    border: 3px solid var(--border-color);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .loading-text { font-size: var(--font-size-sm); }

  /* -------- раскладка: гаттер + оглавление + код -------- */
  .code-wrap {
    position: absolute; inset: 0;
    display: flex;
  }

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
    font-size: 11px;
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
    font-size: 11px;
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
    font-size: 11px;
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
    max-width: 420px;
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
    font-size: 11px;
    font-weight: 600;
    color: #fff;
    background: var(--text-muted);
  }

  .ac-kind.word { background: #7f848e; }
  .ac-kind.var { background: #61afef; }
  .ac-kind.cmd { background: #e06c75; }

  .ac-label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  :global(.tok-section) { color: #e8a15c; }
  :global(.tok-driver) { color: #56b6c2; }
  :global(.tok-pin) { color: #61afef; }
  :global(.tok-num) { color: #d19a66; }
  :global(.tok-comment) { color: #7f848e; font-style: italic; }
  :global(.tok-save-mark) { color: #c678dd; font-weight: 600; }
  :global(.tok-cmd) { color: #e06c75; }
  :global(.tok-ext) { color: #e8a15c; }
  :global(.tok-axis) { color: #e06c75; }
  :global(.tok-param) { color: #c850d8; }
  :global(.tok-str) { color: #c678dd; }
  :global(.tok-jinja) { color: #56b6c2; }
  :global(.tok-jinja-kw) { color: #c678dd; }
  :global(.tok-jinja-var) { color: #91df6d; }
  :global(.tok-filter) { color: #98c379; }
</style>