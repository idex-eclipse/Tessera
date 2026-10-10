import type { PluginApi } from '../../../plugin-sdk/src/types';

export const READONLY_ROOTS = ['logs', 'docs', 'config_examples'];

export const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'svg', 'webp'];

export const DEFAULT_EDITABLE_EXT = [
  'conf', 'cfg', 'txt', 'md', 'ini', 'yaml', 'yml', 'json', 'sh', 'py',
];

export function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i + 1).toLowerCase() : '';
}

export function getEditableExt(api: PluginApi): string[] {
  const custom = api.settings.get<string[]>('editableExt');
  return Array.isArray(custom) && custom.length > 0 ? custom : DEFAULT_EDITABLE_EXT;
}

export interface FileCap {
  canOpen: boolean;          // какой-то вьюер/редактор умеет
  mode: 'edit' | 'view' | null;
  readonly: boolean;
}

export function fileCap(api: PluginApi, filename: string, root: string): FileCap {
  const ext = extOf(filename);
  const readonlyRoot = READONLY_ROOTS.includes(root);

  if (IMAGE_EXT.includes(ext)) {
    return { canOpen: true, mode: 'view', readonly: true };
  }

  // логи, включая ротированные: klippy.log, klippy.log.2026-08-11, telegram.log.1
  const isLog = /\.log(\..*)?$/i.test(filename);

  const editable = getEditableExt(api).includes(ext) || isLog;

  if (editable) {
    // логи read-only всегда; логи/докс/примеры — read-only по руту
    return { canOpen: true, mode: 'edit', readonly: readonlyRoot || isLog };
  }

  return { canOpen: false, mode: null, readonly: readonlyRoot };
}