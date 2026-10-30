/**
 * Минимальный разбор markdown из Config_Reference.md в модель для Svelte.
 *
 * Намеренно не в HTML: прозу рендерит шаблон текстовыми узлами, поэтому текст из
 * документа не попадает в разметку и экранировать нечего. Поддерживается только то,
 * что реально есть в справке: абзацы, `####`-заголовки, списки `- `, блоки ```,
 * `код`, **жирный**, *курсив* и ссылки.
 */

export type Inline =
  | { t: 'text'; v: string }
  | { t: 'code'; v: string }
  | { t: 'bold'; v: Inline[] }
  | { t: 'italic'; v: Inline[] }
  | { t: 'link'; text: string; href: string; external: boolean };

export type Block =
  | { t: 'heading'; level: number; inline: Inline[] }
  | { t: 'p'; inline: Inline[] }
  | { t: 'list'; items: Inline[][] }
  | { t: 'code'; text: string };

// regexp создаётся на каждый вызов: parseInline рекурсивен, а lastIndex у /g общий
const TOKEN_SRC = '`([^`]+)`|\\*\\*([^*]+)\\*\\*|\\*([^\\s*][^*]*?)\\*|\\[([^\\]]+)\\]\\(([^)\\s]+)\\)';

function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && /\w/.test(ch);
}

export function parseInline(s: string): Inline[] {
  const out: Inline[] = [];
  let pos = 0;
  const pushText = (v: string): void => {
    if (!v) return;
    const last = out[out.length - 1];
    if (last && last.t === 'text') last.v += v;
    else out.push({ t: 'text', v });
  };

  const TOKEN_RE = new RegExp(TOKEN_SRC, 'g');
  let m: RegExpExecArray | null;
  while ((m = TOKEN_RE.exec(s)) !== null) {
    const start = m.index;
    const end = start + m[0].length;

    if (m[3] !== undefined) {
      // одиночная звёздочка — курсив только на границах слов (иначе это `a*b`)
      if (isWordChar(s[start - 1]) || isWordChar(s[end])) {
        TOKEN_RE.lastIndex = start + 1;
        continue;
      }
    }

    pushText(s.slice(pos, start));
    if (m[1] !== undefined) out.push({ t: 'code', v: m[1] });
    else if (m[2] !== undefined) out.push({ t: 'bold', v: parseInline(m[2]) });
    else if (m[3] !== undefined) out.push({ t: 'italic', v: parseInline(m[3]) });
    else {
      const href = m[5] ?? '';
      out.push({ t: 'link', text: m[4] ?? '', href, external: /^https?:\/\//i.test(href) });
    }
    pos = end;
  }
  pushText(s.slice(pos));
  return out;
}

const FENCE_RE = /^\s*```/;
const HEADING_RE = /^(#{3,6}) (.*)$/;
const BULLET_RE = /^\s*[-*+] (.*)$/;

/** Строки фрагмента (без его заголовка `### […]`) → блоки. */
export function parseBlocks(lines: string[]): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  // состояние в объекте, а не в `let`: его меняют замыкания, и TS иначе сужает тип до null
  const st: { list: string[] | null } = { list: null };

  const flushPara = (): void => {
    if (para.length > 0) blocks.push({ t: 'p', inline: parseInline(para.join(' ')) });
    para = [];
  };
  const flushList = (): void => {
    if (st.list) blocks.push({ t: 'list', items: st.list.map((s) => parseInline(s)) });
    st.list = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';

    if (FENCE_RE.test(line)) {
      flushPara();
      flushList();
      const code: string[] = [];
      i++;
      while (i < lines.length && !FENCE_RE.test(lines[i] ?? '')) {
        code.push(lines[i] ?? '');
        i++;
      }
      while (code.length > 0 && (code[code.length - 1] ?? '').trim() === '') code.pop();
      blocks.push({ t: 'code', text: code.join('\n') });
      continue;
    }

    if (line.trim() === '') {
      flushPara();
      flushList();
      continue;
    }

    const h = HEADING_RE.exec(line);
    if (h) {
      flushPara();
      flushList();
      blocks.push({ t: 'heading', level: (h[1] ?? '').length, inline: parseInline((h[2] ?? '').trim()) });
      continue;
    }

    const b = BULLET_RE.exec(line);
    if (b) {
      flushPara();
      (st.list ??= []).push((b[1] ?? '').trim());
      continue;
    }

    if (st.list) {
      // продолжение пункта списка
      st.list[st.list.length - 1] = `${st.list[st.list.length - 1] ?? ''} ${line.trim()}`;
    } else {
      para.push(line.trim());
    }
  }
  flushPara();
  flushList();
  return blocks;
}
