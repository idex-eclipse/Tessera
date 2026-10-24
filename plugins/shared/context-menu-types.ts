/**
 * Пункт контекстного меню. Вынесен в .ts: типы из .svelte недоступны обычным
 * TypeScript-модулям (jobs-menu.ts и т.п.), только svelte-check их видит.
 */
export interface ContextMenuItem {
  id: string;
  label: string;
  icon?: string;
  danger?: boolean;
  disabled?: boolean;
}
