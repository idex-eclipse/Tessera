export type SystemTab = 'overview' | 'monitoring' | 'maintenance';

export const SYSTEM_TABS: readonly SystemTab[] = ['overview', 'monitoring', 'maintenance'];

/** Describes a physical horizontal direction in the rendered tab row. */
export type SystemTabSide = 'left' | 'right';

/**
 * Внутреннее UI-состояние @core/system (правая панель, вкладки страницы).
 * НЕ межплагинная шина: приватный модуль одного плагина.
 */
class SystemUiState {
  /**
   * Активная вкладка страницы «Система». Источник истины здесь, а не в компоненте:
   * hotkeys Alt+1/2/3 переключают её извне, и выбор переживает уход со страницы.
   * Это id встроенной вкладки (SystemTab) или ref вкладки дополнения (`<plugin>/<id>`,
   * точка `tabs`), поэтому тип шире SystemTab; страница откатывает исчезнувший ref на 'overview'.
   */
  activeTab = $state<string>('overview');
  /** Tracks the rendered order, including contributed tabs, for arrow hotkeys. */
  tabOrder = $state<string[]>([...SYSTEM_TABS]);
  /** Alt+R (hotkey) просит страницу «Система» перечитать данные. */
  refreshSeq = $state(0);
  /** U (hotkey): правая панель открывает выбор файла для загрузки. */
  uploadPickSeq = $state(0);
  /** P (hotkey): правая панель переключает «Начать печать после загрузки». */
  printAfterToggleSeq = $state(0);
}

export const systemUiState = new SystemUiState();

/** Moves to the visually adjacent available tab and wraps at either end. */
export function moveSystemTab(side: SystemTabSide, rtl: boolean): void {
  const tabs = systemUiState.tabOrder;
  if (tabs.length < 2) return;
  const current = tabs.indexOf(systemUiState.activeTab);
  const index = current >= 0 ? current : 0;
  // DOM order starts at the visual right in RTL, so the physical arrow step is reversed.
  const step = (side === 'right') !== rtl ? 1 : -1;
  systemUiState.activeTab = tabs[(index + step + tabs.length) % tabs.length] ?? tabs[0] ?? 'overview';
}
