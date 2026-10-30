import {
  STORAGE_KEY,
  emptyColors,
  parseColors,
  withColor,
  withoutTheme,
  type ColorMap,
  type StoredColors,
  type ThemeName,
  type TokKey,
} from './highlight-colors';

function load(): StoredColors {
  try {
    return parseColors(localStorage.getItem(STORAGE_KEY));
  } catch {
    return emptyColors();
  }
}

function persist(data: StoredColors): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // квота / приватный режим — значения живут до перезагрузки
  }
}

// Плагины-хозяева диалога (config, jobs) могут получить собственные копии модуля,
// поэтому источник истины — localStorage: другие вкладки ловим через storage,
// а диалог зовёт reloadColors() при каждом открытии.
const store = $state<{ data: StoredColors }>({ data: load() });

export function reloadColors(): void {
  store.data = load();
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY || e.key === null) reloadColors();
  });
}

/** Реактивно: пользовательские значения для темы (пусто — везде дефолты). */
export function getOverrides(theme: ThemeName): ColorMap {
  return store.data[theme];
}

export function setColor(theme: ThemeName, key: TokKey, hex: string | null): void {
  store.data = withColor(store.data, theme, key, hex);
  persist(store.data);
}

export function resetTheme(theme: ThemeName): void {
  store.data = withoutTheme(store.data, theme);
  persist(store.data);
}
