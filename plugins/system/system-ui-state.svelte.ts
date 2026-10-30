export type SystemTab = 'overview' | 'monitoring' | 'maintenance';

export const SYSTEM_TABS: readonly SystemTab[] = ['overview', 'monitoring', 'maintenance'];

/**
 * Внутреннее UI-состояние @core/system (правая панель ↔ оверлей уведомлений,
 * вкладки страницы). НЕ межплагинная шина: приватный модуль одного плагина.
 */
class SystemUiState {
  /**
   * Активная вкладка страницы «Система». Источник истины здесь, а не в компоненте:
   * hotkeys Alt+1/2/3 переключают её извне, и выбор переживает уход со страницы.
   */
  activeTab = $state<SystemTab>('overview');
  notificationsOpen = $state(false);
  /** Alt+R (hotkey) просит страницу «Система» перечитать данные. */
  refreshSeq = $state(0);
  /** U (hotkey): правая панель открывает выбор файла для загрузки. */
  uploadPickSeq = $state(0);
  /** P (hotkey): правая панель переключает «Начать печать после загрузки». */
  printAfterToggleSeq = $state(0);
}

export const systemUiState = new SystemUiState();