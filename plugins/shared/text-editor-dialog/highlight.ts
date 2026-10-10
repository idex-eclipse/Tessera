// Построчный автомат: config / gcode / save_config.
// Возвращает HTML с <span class="tok-*">. Всё экранируется.

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const sp = (cls: string, s: string) => `<span class="${cls}">${esc(s)}</span>`;

const DRIVER = 'tmc\\d+|ads\\d+|sx1509|mcp4018|pca9685|hx71\\d';

// value: driver | string | number
const VAL_RE = new RegExp(
  `(${DRIVER})|('(?:[^'\\\\]|\\\\.)*'|"(?:[^"\\\\]|\\\\.)*")|(-?\\d+(?:\\.\\d+)?)`,
  'gi',
);

function wrapGap(s: string, cls: string | null): string {
  return cls ? sp(cls, s) : esc(s);
}

const VAL_FULL = new RegExp(
  `(${DRIVER})|('(?:[^'\\\\]|\\\\.)*'|"(?:[^"\\\\]|\\\\.)*")|(-?\\d+(?:\\.\\d+)?)`,
  'gi',
);
// для пинов: только driver и строки; цифры остаются в цвете пина
const VAL_PIN = new RegExp(
  `(${DRIVER})|('(?:[^'\\\\]|\\\\.)*'|"(?:[^"\\\\]|\\\\.)*")`,
  'gi',
);

function paintValue(text: string, isPin: boolean): string {
  const re = new RegExp(isPin ? VAL_PIN.source : VAL_FULL.source, 'gi');
  let out = '';
  let last = 0;
  let m: RegExpExecArray | null;
  const gap = isPin ? 'tok-pin' : null;

  while ((m = re.exec(text))) {
    if (m.index > last) out += wrapGap(text.slice(last, m.index), gap);
    const t = m[0];
    const cls = m[1] ? 'tok-driver' : m[2] ? 'tok-str' : 'tok-num';
    out += sp(cls, t);
    last = m.index + t.length;
  }
  if (last < text.length) out += wrapGap(text.slice(last), gap);
  return out;
}

function paintName(name: string): string {
  const re = new RegExp(`(${DRIVER})`, 'gi');
  let out = '';
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(name))) {
    if (m.index > last) out += sp('tok-section', name.slice(last, m.index));
    out += sp('tok-driver', m[0]);
    last = m.index + m[0].length;
  }
  if (last < name.length) out += sp('tok-section', name.slice(last));
  return out;
}

function paintSection(line: string): string {
  const m = /^(\s*)(\[)([^\]]*)(\])(.*)$/.exec(line);
  if (!m) return esc(line);

  const [rest, com] = splitComment(m[5]??'');
  return (
    esc(m[1]??'') +
    sp('tok-section', m[2]??'') +
    paintName(m[3]??'') +
    sp('tok-section', m[4]??'') +
    esc(rest) +
    (com !== null ? sp('tok-comment', com) : '')
  );
}

function splitComment(s: string): [string, string | null] {
  const i = s.search(/\s#/);
  return i >= 0 ? [s.slice(0, i), s.slice(i)] : [s, null];
}

function configLine(line: string): string {
  const t = line.trim();
  if (t === '') return esc(line);
  if (/^[#;]/.test(t)) return sp('tok-comment', line);
  if (/^\[.*\]/.test(t)) return paintSection(line);

  const km = /^(\s*)([A-Za-z0-9_]+)(\s*[:=]\s*)(.*)$/.exec(line);
  if (km) {
    const isPin = /pin$/i.test(km[2]??'');
    const [val, com] = splitComment(km[4]??'');
    let out = esc(km[1]??'') + esc(km[2]??'') + esc(km[3]??'') + paintValue(val, isPin);
    if (com !== null) out += sp('tok-comment', com);
    return out;
  }
  return esc(line);
}



// ---------------- gcode ----------------

const GCODE_RE =
  /(\{[^}]*\})|('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")|([GM]\d+(?:\.\d+)?)|([A-Z][A-Z0-9_]{2,}\b(?!=))|([A-Z](?=-?\d))|([A-Z_][A-Z0-9_]*(?==))|(-?\d+(?:\.\d+)?)/;

function paintJinjaInner(s: string): string {
  const re =
    /(\|\s*[a-zA-Z_][\w]*)|(\b(?:if|elif|else|endif|for|endfor|set|print|while|break|continue|in|not|and|or|true|false|none)\b)|(printer\.[\w.[\]']+|params\.[\w.[\]']+|[a-zA-Z_][\w]*)/g;
  re.lastIndex = 0;
  let out = '';
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m.index > last) out += esc(s.slice(last, m.index));
    out += sp(m[1] ? 'tok-filter' : m[2] ? 'tok-jinja-kw' : 'tok-jinja-var', m[0]);
    last = m.index + m[0].length;
  }
  if (last < s.length) out += esc(s.slice(last));
  return out;
}

function varSpan(v: string): string {
  const bare = /^[A-Za-z_][A-Za-z0-9_]*$/.test(v);
  return `<span class="tok-jinja-var"${bare ? ` data-var="${esc(v)}"` : ''}>${esc(v)}</span>`;
}

function paintJinja(block: string): string {
  const open = block.startsWith('{{') ? '{{' : block.startsWith('{%') ? '{%' : '{';
  const close = block.endsWith('}}') ? '}}' : block.endsWith('%}') ? '%}' : '}';
  const inner = block.slice(open.length, block.length - close.length);
  return sp('tok-jinja', open) + paintJinjaInner(inner) + sp('tok-jinja', close);
}

function paintGcode(code: string): string {
  const re = new RegExp(GCODE_RE.source, 'g');
  re.lastIndex = 0;
  let out = '';
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    if (m.index > last) out += esc(code.slice(last, m.index));
    const t = m[0];
    out += m[1]
      ? paintJinja(t)
      : m[2]
        ? sp('tok-str', t)
        : m[3]
          ? sp('tok-cmd', t)
          : m[4]
            ? sp('tok-ext', t)
            : m[5]
              ? sp('tok-axis', t)
              : m[6]
                ? sp('tok-param', t)
                : sp('tok-num', t);
    last = m.index + t.length;
  }
  if (last < code.length) out += esc(code.slice(last));
  return out;
}

/**
 * Первый символ комментария (';' или '#') вне строк и вне {...} (jinja).
 * Возвращает -1, если комментария нет.
 */
function findCommentStart(line: string): number {
  let inStr: string | null = null;
  let brace = 0;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i] ?? '';

    if (inStr) {
      if (ch === '\\') { i++; continue; }
      if (ch === inStr) inStr = null;
      continue;
    }

    if (ch === '"' || ch === "'") { inStr = ch; continue; }
    if (ch === '{') { brace++; continue; }
    if (ch === '}') { brace = Math.max(0, brace - 1); continue; }

    if (brace === 0 && (ch === ';' || ch === '#')) return i;
  }

  return -1;
}

function gcodeLine(line: string): string {
  const t = line.trim();
  if (t === '') return esc(line);
  // комментарий во всю строку
  if (/^[;#]/.test(t)) return sp('tok-comment', line);

  // полстрочный комментарий: первый ';' или '#' вне jinja/строк
  const ci = findCommentStart(line);
  let out = paintGcode(ci >= 0 ? line.slice(0, ci) : line);
  if (ci >= 0) out += sp('tok-comment', line.slice(ci));
  return out;
}

// ---------------- save_config ----------------

function saveMarker(line: string): string {
  return line
    .replace(/^(#\*#)/, `§C§$1§/§`)
    .replace(/SAVE_CONFIG/, `§S§SAVE_CONFIG§/§`);
}

function saveLine(line: string): string {
  const m = /^(#\*#)(\s?)(.*)$/.exec(line);
  if (!m) return sp('tok-comment', line);
  return sp('tok-comment', m[1]??'') + esc(m[2]??'') + saveInner(m[3]??'');
}

function saveInner(rest: string): string {
  const t = rest.trim();
  if (t === '') return esc(rest);
  if (/^\[.*\]/.test(t)) return paintSection(rest);
  const km = /^(\s*)([A-Za-z0-9_]+)(\s*[:=]\s*)(.*)$/.exec(rest);
  if (km) return esc(km[1]??'') + esc(km[2]??'') + esc(km[3]??'') + paintValue(km[4]??'', false);
  return esc(rest);
}

// ---------------- entry ----------------

export function highlightKlipper(text: string): string {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  let mode: 'config' | 'gcode' | 'save' = 'config';

  for (const line of lines) {
    if (mode === 'save') {
      out.push(saveLine(line));
      continue;
    }

    if (/^#\*#.*SAVE_CONFIG/.test(line)) {
      mode = 'save';
      // маркер: #*# комментарий, SAVE_CONFIG акцент, остальное комментарий
      out.push(
        sp('tok-comment', '#*#') +
          esc(line.slice(3, line.indexOf('SAVE_CONFIG'))) +
          sp('tok-save-mark', 'SAVE_CONFIG') +
          sp('tok-comment', line.slice(line.indexOf('SAVE_CONFIG') + 11)),
      );
      continue;
    }

    if (mode === 'config') {
      if (/^\s*gcode\s*[:=]\s*$/i.test(line)) {
        mode = 'gcode';
        out.push(esc(line));
        continue;
      }
      out.push(configLine(line));
    } else {
      if (/^\S/.test(line) && line.trim() !== '') {
        mode = 'config';
        out.push(configLine(line));
      } else {
        out.push(gcodeLine(line));
      }
    }
  }
  return out.join('\n');
}

export function highlightPlain(text: string): string {
  return esc(text);
}