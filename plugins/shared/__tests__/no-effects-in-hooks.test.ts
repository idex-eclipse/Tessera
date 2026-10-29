import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Хуки и ядра плагинов (`*.svelte.ts`) не содержат `$effect`.
 *
 * Ядра keep-alive живут дольше компонента, который их создал, а эффект привязан к
 * жизненному циклу этого компонента: после его пересоздания ядро осталось бы мёртвым.
 * Поэтому подписки делаются императивно — по `onReady` / `onNotify` — как в
 * `use-calibrations.svelte.ts`. Реактивность на стороне компонента (`$effect` в
 * `.svelte`) этим правилом не затрагивается.
 */

const PLUGINS_DIR = fileURLToPath(new URL('../..', import.meta.url));

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '__tests__' || name === 'dist') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (name.endsWith('.svelte.ts')) out.push(full);
  }
  return out;
}

/** Комментарии могут упоминать `$effect` (объясняя, почему его нет) — их не считаем. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('hooks and cores', () => {
  const files = walk(PLUGINS_DIR);

  it('finds the hook files (the scan itself is not vacuous)', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it('contain no $effect (subscribe imperatively via onReady / onNotify)', () => {
    const offenders = files
      .filter((f) => /\$effect/.test(stripComments(readFileSync(f, 'utf8'))))
      .map((f) => relative(PLUGINS_DIR, f).replaceAll('\\', '/'))
      .sort();
    expect(offenders).toEqual([]);
  });
});
