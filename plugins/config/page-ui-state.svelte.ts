/**
 * UI-состояние страницы конфигов, управляемое снаружи компонента (hotkeys).
 * Обработчики hotkeys живут в модуле плагина и не имеют доступа к компоненту,
 * поэтому страница читает вкладку и «активную панель» отсюда (module-state).
 * Побочный плюс: выбранная вкладка правой таблицы переживает уход со страницы.
 */

export const CONFIG_TABS = ['logs', 'docs', 'config_examples'] as const;
export type ConfigTab = (typeof CONFIG_TABS)[number];

/** Левая таблица — config; правая — logs / docs / config_examples. */
export type ConfigPane = 'left' | 'right';

export const pageUi = $state<{ tab: ConfigTab; pane: ConfigPane }>({
  tab: 'logs',
  pane: 'left',
});

/** Выбрать вкладку правой таблицы (она же становится активной панелью). */
export function setTab(tab: ConfigTab): void {
  pageUi.tab = tab;
  pageUi.pane = 'right';
}

export function setActivePane(pane: ConfigPane): void {
  pageUi.pane = pane;
}

/** scope таблицы, в которой сейчас работает пользователь (для фокуса на поиск). */
export function activeSearchScope(): string {
  return pageUi.pane === 'right' ? `page:${pageUi.tab}` : 'page:config';
}
