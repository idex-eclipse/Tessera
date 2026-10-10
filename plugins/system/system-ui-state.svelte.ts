/**
 * Внутреннее UI-состояние @core/system (правая панель ↔ оверлей уведомлений).
 * НЕ межплагинная шина: приватный модуль одного плагина.
 */
class SystemUiState {
  notificationsOpen = $state(false);
}

export const systemUiState = new SystemUiState();