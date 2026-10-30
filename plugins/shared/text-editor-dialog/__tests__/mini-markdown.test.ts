import { describe, expect, it } from 'vitest';

import { parseBlocks, parseInline } from '../mini-markdown';

describe('parseInline', () => {
  it('обычный текст остаётся текстом, спецсимволы HTML не трогаем', () => {
    expect(parseInline('a <b> & c')).toEqual([{ t: 'text', v: 'a <b> & c' }]);
  });

  it('код, жирный, курсив', () => {
    expect(parseInline('use `PA4` and **bold** or *soft*')).toEqual([
      { t: 'text', v: 'use ' },
      { t: 'code', v: 'PA4' },
      { t: 'text', v: ' and ' },
      { t: 'bold', v: [{ t: 'text', v: 'bold' }] },
      { t: 'text', v: ' or ' },
      { t: 'italic', v: [{ t: 'text', v: 'soft' }] },
    ]);
  });

  it('вложенность разбирается рекурсивно и не ломает внешний разбор', () => {
    expect(parseInline('**a `b`** then `c`')).toEqual([
      { t: 'bold', v: [{ t: 'text', v: 'a ' }, { t: 'code', v: 'b' }] },
      { t: 'text', v: ' then ' },
      { t: 'code', v: 'c' },
    ]);
  });

  it('звёздочка внутри слова — не курсив', () => {
    expect(parseInline('Kp*error + Ki*integral')).toEqual([
      { t: 'text', v: 'Kp*error + Ki*integral' },
    ]);
  });

  it('ссылки: относительные не внешние, http(s) внешние', () => {
    expect(parseInline('see [Docs](Installation.md#x) and [site](https://example.com/a)')).toEqual([
      { t: 'text', v: 'see ' },
      { t: 'link', text: 'Docs', href: 'Installation.md#x', external: false },
      { t: 'text', v: ' and ' },
      { t: 'link', text: 'site', href: 'https://example.com/a', external: true },
    ]);
  });

  it('javascript: не считается внешней ссылкой', () => {
    const [node] = parseInline('[x](javascript:alert(1))');
    expect(node).toMatchObject({ t: 'link', external: false });
  });
});

describe('parseBlocks', () => {
  it('абзацы склеиваются по пустым строкам, переносы внутри — пробелом', () => {
    expect(parseBlocks(['first line', 'second line', '', 'next para'])).toEqual([
      { t: 'p', inline: [{ t: 'text', v: 'first line second line' }] },
      { t: 'p', inline: [{ t: 'text', v: 'next para' }] },
    ]);
  });

  it('блок кода берётся как есть, хвостовые пустые строки срезаются', () => {
    const blocks = parseBlocks(['```', '[mcu]', '# note', '', '```', 'after']);
    expect(blocks[0]).toEqual({ t: 'code', text: '[mcu]\n# note' });
    expect(blocks[1]).toMatchObject({ t: 'p' });
  });

  it('незакрытый блок кода не падает', () => {
    expect(parseBlocks(['```', 'a', 'b'])).toEqual([{ t: 'code', text: 'a\nb' }]);
  });

  it('списки и продолжение пункта', () => {
    const blocks = parseBlocks(['Intro:', '- one', '- two', '  continued', '', 'tail']);
    expect(blocks[0]).toMatchObject({ t: 'p' });
    expect(blocks[1]).toEqual({
      t: 'list',
      items: [[{ t: 'text', v: 'one' }], [{ t: 'text', v: 'two continued' }]],
    });
    expect(blocks[2]).toMatchObject({ t: 'p' });
  });

  it('#### — подзаголовок', () => {
    expect(parseBlocks(['#### hd44780 display', 'text'])).toEqual([
      { t: 'heading', level: 4, inline: [{ t: 'text', v: 'hd44780 display' }] },
      { t: 'p', inline: [{ t: 'text', v: 'text' }] },
    ]);
  });
});
