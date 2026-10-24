/**
 * Внутреннее UI-состояние @core/system (правая панель ↔ оверлей уведомлений).
 * НЕ межплагинная шина: приватный модуль одного плагина.
 */
class SystemUiState {
  notificationsOpen = $state(false);
  /** Alt+R (hotkey) просит страницу «Система» перечитать данные. */
  refreshSeq = $state(0);
}

export const systemUiState = new SystemUiState();