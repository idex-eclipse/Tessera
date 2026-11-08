import { describe, expect, it, vi } from 'vitest';

import { replaceEditorRange } from '../editor-replacement';

describe('editor range replacement', () => {
  it('uses native editing for an undoable backup change', () => {
    const ta = document.createElement('textarea');
    document.body.appendChild(ta);
    ta.value = 'old\nkeep';
    const previous = Object.getOwnPropertyDescriptor(document, 'execCommand');
    const exec = vi.fn((_command: string, _showUi: boolean, insert: string) => {
      ta.setRangeText(insert, ta.selectionStart, ta.selectionEnd, 'end');
      return true;
    });
    Object.defineProperty(document, 'execCommand', { configurable: true, value: exec });
    try {
      expect(replaceEditorRange(ta, 0, 3, 'new')).toEqual({ value: 'new\nkeep', nativeUndo: true });
      expect(exec).toHaveBeenCalledWith('insertText', false, 'new');
    } finally {
      if (previous) Object.defineProperty(document, 'execCommand', previous);
      else Reflect.deleteProperty(document, 'execCommand');
      ta.remove();
    }
  });

  it('updates the visible textarea when native editing is unavailable', () => {
    const ta = document.createElement('textarea');
    document.body.appendChild(ta);
    ta.value = 'old\nkeep';
    const previous = Object.getOwnPropertyDescriptor(document, 'execCommand');
    Object.defineProperty(document, 'execCommand', { configurable: true, value: () => false });
    try {
      expect(replaceEditorRange(ta, 0, 3, 'new')).toEqual({ value: 'new\nkeep', nativeUndo: false });
      expect(ta.value).toBe('new\nkeep');
    } finally {
      if (previous) Object.defineProperty(document, 'execCommand', previous);
      else Reflect.deleteProperty(document, 'execCommand');
      ta.remove();
    }
  });
});
