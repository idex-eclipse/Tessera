/** Replace a textarea range through native editing so one change can be undone with Ctrl+Z. */
export function replaceEditorRange(ta: HTMLTextAreaElement, start: number, end: number, insert: string): { value: string; nativeUndo: boolean } {
  ta.focus();
  ta.setSelectionRange(start, end);
  const original = ta.value;
  const expected = original.slice(0, start) + insert + original.slice(end);
  const nativeUndo = typeof document.execCommand === 'function'
    && document.execCommand('insertText', false, insert)
    && ta.value === expected;
  if (!nativeUndo) {
    // This fallback cannot join the browser's undo stack, but must keep the DOM value correct.
    if (ta.value !== original) ta.value = original;
    ta.setSelectionRange(start, end);
    ta.setRangeText(insert, start, end, 'end');
  }
  return { value: ta.value, nativeUndo };
}
