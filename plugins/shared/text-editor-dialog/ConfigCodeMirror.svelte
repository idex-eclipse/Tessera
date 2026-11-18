<script lang="ts">
  import { onMount } from 'svelte';
  import { EditorState, Compartment, StateField, StateEffect, Transaction, Prec } from '@codemirror/state';
  import { EditorView, Decoration, WidgetType, lineNumbers, highlightActiveLine } from '@codemirror/view';
  import { defaultKeymap, history, historyField, historyKeymap } from '@codemirror/commands';
  import { closeBrackets } from '@codemirror/autocomplete';
  import { keymap } from '@codemirror/view';
  import { highlightKlipperLines } from './highlight';
  import { runConfigTab } from './config-code-indent';

  /** Serialized CodeMirror history lets each cfg tab keep undo and redo across remounts. */
  export type EditorSnapshot = ReturnType<EditorState['toJSON']>;

  /** A peek edits a section buffer; the owning dialog decides how it reaches its file. */
  export interface PeekSpec {
    lineEnd: number;
    firstLine: number;
    title: string;
    detail: string;
    section: string;
    saveLabel: string;
    openLabel: string;
    closeLabel: string;
    onChange: (text: string) => void;
    onSave: () => void;
    onOpen: () => void;
    onClose: () => void;
    onCommit?: () => void;
    onAttach?: (sync: ((section: string) => void) | null) => void;
  }

  let {
    value,
    readonly = false,
    peek = null,
    view = $bindable(null),
    onChange,
    onCursor,
    onGesture,
    allowManagedHotkeys = false,
    onScroll,
    onEditorKey,
    onCompletionKey,
    compareMarks = new Map(),
    snapshot,
    onSnapshot,
  }: {
    value: string;
    readonly?: boolean;
    peek?: PeekSpec | null;
    view?: EditorView | null;
    onChange: (value: string) => void;
    onCursor: (position: number) => void;
    onGesture: (position: number, kind: 'peek' | 'open') => boolean;
    allowManagedHotkeys?: boolean;
    onScroll: (top: number) => void;
    onEditorKey: (event: KeyboardEvent) => boolean;
    onCompletionKey: (key: string) => boolean;
    compareMarks?: Map<number, 'added' | 'removed' | 'changed'>;
    snapshot?: EditorSnapshot;
    onSnapshot?: (state: EditorSnapshot) => void;
  } = $props();

  let mount: HTMLDivElement;
  let externalUpdate = false;
  const readonlySlot = new Compartment();
  const compareSlot = new Compartment();

  /** Reuse the established Klipper tokenizer so custom token colors match the old editor. */
  function syntaxMarks(text: string) {
    const ranges: ReturnType<ReturnType<typeof Decoration.mark>['range']>[] = [];
    const holder = document.createElement('div');
    let offset = 0;
    for (const html of highlightKlipperLines(text)) {
      // The tokenizer escapes source text; parsing its flat spans preserves exact offsets.
      holder.innerHTML = html;
      let column = 0;
      for (const node of holder.childNodes) {
        const length = node.textContent?.length ?? 0;
        if (length && node instanceof HTMLElement && node.className.startsWith('tok-')) {
          ranges.push(Decoration.mark({ class: `cm-${node.className}` })
            .range(offset + column, offset + column + length));
        }
        column += length;
      }
      offset += column + 1;
    }
    return Decoration.set(ranges, true);
  }

  // A state field keeps marks aligned with edits without rebuilding the editor view.
  const syntaxField = StateField.define({
    create: (state) => syntaxMarks(state.doc.toString()),
    update: (marks, transaction) => transaction.docChanged ? syntaxMarks(transaction.state.doc.toString()) : marks,
  });

  class PeekWidget extends WidgetType {
    private child: EditorView | null = null;
    private syncing = false;
    private root: HTMLElement | null = null;
    private blurHandler = (event: FocusEvent) => {
      // Let a click on a peek button complete before committing and remounting the widget.
      if (event.relatedTarget && this.root?.contains(event.relatedTarget as Node)) return;
      this.spec.onCommit?.();
    };
    readonly spec: PeekSpec;
    constructor(spec: PeekSpec) { super(); this.spec = spec; }
    override eq(other: PeekWidget): boolean { return other.spec === this.spec; }
    override toDOM(): HTMLElement {
      const root = document.createElement('div');
      this.root = root;
      root.className = 'cm-peek';
      root.dir = document.documentElement.dir === 'rtl' ? 'rtl' : 'ltr';
      const header = document.createElement('div');
      header.className = 'cm-peek-head';
      const title = document.createElement('span');
      title.textContent = `${this.spec.title} · ${this.spec.detail}`;
      title.title = this.spec.detail;
      title.dir = 'ltr';
      header.append(title);
      for (const [label, action] of [
        [this.spec.saveLabel, this.spec.onSave],
        [this.spec.openLabel, this.spec.onOpen],
        [this.spec.closeLabel, this.spec.onClose],
      ] as const) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = label;
        button.setAttribute('aria-label', label);
        button.addEventListener('click', action);
        header.append(button);
      }
      root.append(header);
      const body = document.createElement('div');
      body.className = 'cm-peek-body';
      body.dir = 'ltr';
      root.append(body);
      this.child = new EditorView({
        parent: body,
        state: EditorState.create({
          doc: this.spec.section,
          extensions: [
            lineNumbers({ formatNumber: (number) => String(number + this.spec.firstLine - 1) }),
            history(), closeBrackets(), syntaxField, EditorView.decorations.from(syntaxField),
            Prec.highest(keymap.of([
              { key: 'Tab', run: (editor) => runConfigTab(editor) },
              { key: 'Shift-Tab', run: (editor) => runConfigTab(editor, true) },
            ])),
            keymap.of([...defaultKeymap, ...historyKeymap]),
            EditorView.domEventHandlers({
              keydown: (event) => {
                // Config's contextual bindings reach the host; other modal editors retain local Escape.
                if (!allowManagedHotkeys) {
                  event.stopPropagation();
                  if (event.key === 'Escape') { event.preventDefault(); this.spec.onClose(); return true; }
                }
                return false;
              },
            }),
            EditorView.updateListener.of((update) => {
              if (update.docChanged && !this.syncing) this.spec.onChange(update.state.doc.toString());
            }),
          ],
        }),
      });
      this.child.contentDOM.addEventListener('blur', this.blurHandler);
      this.spec.onAttach?.((section) => {
        if (!this.child || this.child.state.doc.toString() === section) return;
        this.syncing = true;
        this.child.dispatch({
          changes: { from: 0, to: this.child.state.doc.length, insert: section },
          annotations: Transaction.addToHistory.of(false),
        });
        this.syncing = false;
      });
      return root;
    }
    override destroy(): void {
      this.spec.onAttach?.(null);
      this.child?.contentDOM.removeEventListener('blur', this.blurHandler);
      this.child?.destroy();
      this.child = null;
      this.root = null;
    }
    override ignoreEvent(): boolean { return true; }
  }

  // The position must map through edits before the call, or CodeMirror removes the widget mid-typing.
  const setPeek = StateEffect.define<PeekSpec | null>();
  const peekField = StateField.define({
    create: () => Decoration.none,
    update: (decorations, transaction) => {
      let next = decorations.map(transaction.changes);
      for (const effect of transaction.effects) {
        if (!effect.is(setPeek)) continue;
        const spec = effect.value;
        next = spec
          ? Decoration.set([Decoration.widget({ widget: new PeekWidget(spec), block: true, side: 1 })
            .range(Math.min(spec.lineEnd, transaction.state.doc.length))])
          : Decoration.none;
      }
      return next;
    },
    provide: (field) => EditorView.decorations.from(field),
  });

  onMount(() => {
    const config = {
      doc: value,
      extensions: [
        lineNumbers(), highlightActiveLine(), history(),
        closeBrackets(),
        // The popup is owned by the dialog; a high-priority keymap must see it before CodeMirror's editing keys.
        Prec.highest(keymap.of([
          { key: 'Tab', run: (editor) => onCompletionKey('Tab') || runConfigTab(editor) },
          { key: 'Shift-Tab', run: (editor) => runConfigTab(editor, true) },
          { key: 'Enter', run: () => onCompletionKey('Enter') },
          { key: 'ArrowUp', run: () => onCompletionKey('ArrowUp') },
          { key: 'ArrowDown', run: () => onCompletionKey('ArrowDown') },
          { key: 'Escape', run: () => onCompletionKey('Escape') },
        ])),
        keymap.of([
          ...defaultKeymap, ...historyKeymap,
        ]),
        readonlySlot.of(EditorState.readOnly.of(readonly)),
        peekField,
        compareSlot.of(EditorView.decorations.of(Decoration.none)),
        syntaxField,
        EditorView.decorations.from(syntaxField),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !externalUpdate) onChange(update.state.doc.toString());
          if (update.selectionSet || update.docChanged) onCursor(update.state.selection.main.head);
        }),
        EditorView.domEventHandlers({
          keydown: (event) => onEditorKey(event),
          click: (event, editor) => {
            if (!(event.ctrlKey || event.metaKey)) return false;
            const position = editor.posAtCoords({ x: event.clientX, y: event.clientY });
            return position !== null && onGesture(position, 'peek');
          },
          contextmenu: (event, editor) => {
            if (!(event.ctrlKey || event.metaKey)) return false;
            const position = editor.posAtCoords({ x: event.clientX, y: event.clientY });
            if (position === null || !onGesture(position, 'open')) return false;
            event.preventDefault();
            return true;
          },
        }),
      ],
    };
    view = new EditorView({
      parent: mount,
      state: snapshot ? EditorState.fromJSON(snapshot, config, { history: historyField }) : EditorState.create(config),
    });
    const scroll = () => onScroll(view?.scrollDOM.scrollTop ?? 0);
    view.scrollDOM.addEventListener('scroll', scroll);
    return () => {
      if (view) {
        onSnapshot?.(view.state.toJSON({ history: historyField }));
        view.scrollDOM.removeEventListener('scroll', scroll);
        view.destroy();
      }
      view = null;
    };
  });

  $effect(() => {
    const editor = view;
    if (!editor) return;
    const current = editor.state.doc.toString();
    if (current !== value) {
      externalUpdate = true;
      editor.dispatch({ changes: { from: 0, to: current.length, insert: value },
        annotations: Transaction.addToHistory.of(false) });
      externalUpdate = false;
    }
  });

  $effect(() => {
    const editor = view;
    if (editor) editor.dispatch({ effects: readonlySlot.reconfigure(EditorState.readOnly.of(readonly)) });
  });

  $effect(() => {
    const editor = view;
    if (!editor) return;
    editor.dispatch({ effects: setPeek.of(peek) });
  });

  $effect(() => {
    const editor = view;
    if (!editor) return;
    const lines = [...compareMarks].filter(([number]) => number >= 1 && number <= editor.state.doc.lines)
      .map(([number, kind]) => Decoration.line({ attributes: { class: `cm-compare-${kind}` } })
        .range(editor.state.doc.line(number).from));
    editor.dispatch({ effects: compareSlot.reconfigure(EditorView.decorations.of(Decoration.set(lines, true))) });
  });
</script>

<div class="cm-mount" bind:this={mount} dir="ltr"></div>

<style>
  .cm-mount { position: absolute; inset: 0; min-width: 0; overflow: hidden; }
  .cm-mount :global(.cm-editor) { height: 100%; background: var(--bg-surface); color: var(--text-primary); font-family: monospace; font-size: var(--font-size-md); }
  .cm-mount :global(.cm-scroller) { overflow: auto; }
  .cm-mount :global(.cm-content) { padding: var(--space-md) 0; font-family: monospace; caret-color: var(--text-primary); }
  /* Keep the theme color if a CodeMirror extension switches to a painted cursor. */
  .cm-mount :global(.cm-cursor) { border-left-color: var(--text-primary); }
  .cm-mount :global(.cm-gutters) { background: var(--bg-surface); border-inline-end: 1px solid var(--border-color); color: var(--text-muted); }
  .cm-mount :global(.cm-activeLine), .cm-mount :global(.cm-activeLineGutter) { background: var(--bg-surface-hover); }
  .cm-mount :global(.cm-tok-section) { color: var(--tok-section); }
  .cm-mount :global(.cm-tok-driver) { color: var(--tok-driver); }
  .cm-mount :global(.cm-tok-pin) { color: var(--tok-pin); }
  .cm-mount :global(.cm-tok-num) { color: var(--tok-num); }
  .cm-mount :global(.cm-tok-comment) { color: var(--tok-comment); font-style: italic; }
  .cm-mount :global(.cm-tok-save-mark) { color: var(--tok-save-mark); font-weight: 600; }
  .cm-mount :global(.cm-tok-cmd) { color: var(--tok-cmd); }
  .cm-mount :global(.cm-tok-ext) { color: var(--tok-ext); }
  .cm-mount :global(.cm-tok-axis) { color: var(--tok-axis); }
  .cm-mount :global(.cm-tok-param) { color: var(--tok-param); }
  .cm-mount :global(.cm-tok-str) { color: var(--tok-str); }
  .cm-mount :global(.cm-tok-jinja) { color: var(--tok-jinja); }
  .cm-mount :global(.cm-tok-jinja-kw) { color: var(--tok-jinja-kw); }
  .cm-mount :global(.cm-tok-jinja-var) { color: var(--tok-jinja-var); }
  .cm-mount :global(.cm-tok-filter) { color: var(--tok-filter); }
  .cm-mount :global(.cm-compare-added) { background: color-mix(in srgb, var(--success) 18%, var(--bg-surface)); }
  .cm-mount :global(.cm-compare-removed) { background: color-mix(in srgb, var(--danger) 14%, var(--bg-surface)); }
  .cm-mount :global(.cm-compare-changed) { background: color-mix(in srgb, var(--accent) 18%, var(--bg-surface)); }
  .cm-mount :global(.cm-peek) { background: var(--bg-surface); border: 1px solid var(--accent); border-radius: var(--radius-md); box-shadow: var(--shadow-md); min-width: 0; overflow: hidden; }
  .cm-mount :global(.cm-peek-head) { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-xs); padding: var(--space-sm); background: var(--bg-surface-hover); }
  .cm-mount :global(.cm-peek-head span) { flex: 1; min-width: 9ch; overflow-wrap: anywhere; }
  .cm-mount :global(.cm-peek-head button) { min-height: 36px; padding-inline: var(--space-sm); border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: var(--bg-surface); color: var(--text-primary); cursor: pointer; }
  .cm-mount :global(.cm-peek-head button:hover) { background: var(--bg-surface-active); }
  .cm-mount :global(.cm-peek-body) { height: min(35vh, 300px); overflow: auto; }
  .cm-mount :global(.cm-peek-body .cm-editor) { height: 100%; }
  @media (max-width: 768px) { .cm-mount :global(.cm-peek-body) { height: min(30vh, 220px); } }
</style>
