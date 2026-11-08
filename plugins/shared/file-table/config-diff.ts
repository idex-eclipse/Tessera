/** One line of a comparison between the saved backup and the current config. */
export interface ConfigDiffLine {
  kind: 'same' | 'removed' | 'added';
  text: string;
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
