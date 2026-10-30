import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type ChangeListener = (e: { matches: boolean }) => void;

function fakeMatchMedia(initial: boolean) {
  const listeners: ChangeListener[] = [];
  const mql = {
    matches: initial,
    addEventListener: (_type: 'change', cb: ChangeListener) => listeners.push(cb),
  };
  const matchMedia = vi.fn(() => mql);
  return {
    matchMedia,
    set(matches: boolean) {
      mql.matches = matches;
      for (const cb of listeners) cb({ matches });
    },
  };
}

// модуль держит состояние на уровне файла — каждый тест грузит свежую копию
async function load() {
  vi.resetModules();
  return import('../use-narrow.svelte.ts');
}

describe('useNarrow', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('берёт начальное значение из media query и реагирует на change', async () => {
    const mm = fakeMatchMedia(true);
    vi.stubGlobal('window', { matchMedia: mm.matchMedia });
    const { useNarrow, NARROW_QUERY } = await load();

    const narrow = useNarrow();
    expect(narrow.value).toBe(true);
    expect(mm.matchMedia).toHaveBeenCalledWith(NARROW_QUERY);

    mm.set(false);
    expect(narrow.value).toBe(false);
    mm.set(true);
    expect(narrow.value).toBe(true);
  });

  it('вешает один слушатель, сколько бы раз ни вызвали хук', async () => {
    const mm = fakeMatchMedia(false);
    vi.stubGlobal('window', { matchMedia: mm.matchMedia });
    const { useNarrow } = await load();

    const a = useNarrow();
    const b = useNarrow();
    expect(mm.matchMedia).toHaveBeenCalledTimes(1);
    mm.set(true);
    expect(a.value).toBe(true);
    expect(b.value).toBe(true);
  });

  it('без matchMedia остаётся «не узкий»', async () => {
    vi.stubGlobal('window', {});
    const { useNarrow } = await load();
    expect(useNarrow().value).toBe(false);
  });

  it('запрос совпадает с брейкпоинтом хоста', async () => {
    const { NARROW_QUERY } = await load();
    expect(NARROW_QUERY).toBe('(max-width: 768px)');
  });
});
