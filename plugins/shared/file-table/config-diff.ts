/** One line of a comparison between the saved backup and the current config. */
export interface ConfigDiffLine {
  kind: 'same' | 'removed' | 'added';
  text: string;
}

/** One aligned row in the desktop comparison; either side may be empty for a change. */
export interface ConfigComparisonRow extends ConfigDiffLine {
  beforeLine: number | null;
  afterLine: number | null;
}

/** Half-open line ranges for one contiguous difference between backup and editor. */
export interface ConfigDiffHunk {
  beforeStart: number;
  beforeEnd: number;
  afterStart: number;
  afterEnd: number;
}

/** Group adjacent insertions and removals so each visible action applies one change. */
export function configDiffHunks(before: string, after: string): ConfigDiffHunk[] {
  const hunks: ConfigDiffHunk[] = [];
  let beforeLine = 0;
  let afterLine = 0;
  let current: ConfigDiffHunk | null = null;
  for (const line of diffConfigLines(before, after)) {
    if (line.kind === 'same') {
      if (current) hunks.push(current);
      current = null;
      beforeLine++;
      afterLine++;
      continue;
    }
    current ??= { beforeStart: beforeLine, beforeEnd: beforeLine, afterStart: afterLine, afterEnd: afterLine };
    if (line.kind === 'removed') current.beforeEnd = ++beforeLine;
    else current.afterEnd = ++afterLine;
  }
  if (current) hunks.push(current);
  return hunks;
}

/** Return the smallest editor range needed to replace one current hunk with backup lines. */
export function configBackupHunkEdit(before: string, after: string, hunk: ConfigDiffHunk): { start: number; end: number; insert: string } {
  const oldLines = before.replace(/\r\n?/g, '\n').split('\n');
  const currentLines = after.replace(/\r\n?/g, '\n').split('\n');
  currentLines.splice(hunk.afterStart, hunk.afterEnd - hunk.afterStart, ...oldLines.slice(hunk.beforeStart, hunk.beforeEnd));
  const result = currentLines.join('\n');
  let start = 0;
  while (start < after.length && start < result.length && after[start] === result[start]) start++;
  let end = after.length;
  let resultEnd = result.length;
  while (end > start && resultEnd > start && after[end - 1] === result[resultEnd - 1]) {
    end--;
    resultEnd--;
  }
  return { start, end, insert: result.slice(start, resultEnd) };
}

/** Assign original and current line numbers without losing deletion positions on mobile. */
export function configComparisonRows(before: string, after: string): ConfigComparisonRow[] {
  let beforeLine = 0;
  let afterLine = 0;
  return diffConfigLines(before, after).map((line) => ({
    ...line,
    beforeLine: line.kind === 'added' ? null : ++beforeLine,
    afterLine: line.kind === 'removed' ? null : ++afterLine,
  }));
}

/** Map changes to current line numbers so the editable buffer can show additions and deletion anchors. */
export function configCurrentLineMarks(before: string, after: string): Map<number, 'added' | 'removed' | 'changed'> {
  const rows = configComparisonRows(before, after);
  const marks = new Map<number, 'added' | 'removed' | 'changed'>();
  const lastLine = after.replace(/\r\n?/g, '\n').split('\n').length;
  let currentLine = 0;
  for (const row of rows) {
    if (row.afterLine !== null) currentLine = row.afterLine;
    if (row.kind === 'added' && row.afterLine !== null) {
      marks.set(row.afterLine, marks.get(row.afterLine) === 'removed' ? 'changed' : 'added');
    } else if (row.kind === 'removed') {
      // A deleted line has no current row; mark its nearest surviving neighbour.
      const anchor = Math.min(currentLine + 1, lastLine);
      marks.set(anchor, marks.get(anchor) === 'added' ? 'changed' : 'removed');
    }
  }
  return marks;
}

/**
 * Use a line LCS for ordinary config files so insertions do not mark every later line as
 * changed. The large-file fallback keeps the browser responsive on generated configs.
 */
export function diffConfigLines(before: string, after: string): ConfigDiffLine[] {
  const a = before.replace(/\r\n?/g, '\n').split('\n');
  const b = after.replace(/\r\n?/g, '\n').split('\n');
  if (a.length * b.length > 1_000_000) {
    const lines: ConfigDiffLine[] = [];
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (a[i] === b[i]) lines.push({ kind: 'same', text: a[i]! });
      else {
        if (i < a.length) lines.push({ kind: 'removed', text: a[i]! });
        if (i < b.length) lines.push({ kind: 'added', text: b[i]! });
      }
    }
    return lines;
  }

  const lengths = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lengths[i]![j] = a[i] === b[j]
        ? lengths[i + 1]![j + 1]! + 1
        : Math.max(lengths[i + 1]![j]!, lengths[i]![j + 1]!);
    }
  }
  const lines: ConfigDiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      lines.push({ kind: 'same', text: a[i++]! });
      j++;
    } else if (i < a.length && (j === b.length || lengths[i + 1]![j]! >= lengths[i]![j + 1]!)) {
      lines.push({ kind: 'removed', text: a[i++]! });
    } else {
      lines.push({ kind: 'added', text: b[j++]! });
    }
  }
  return lines;
}
