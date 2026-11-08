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
