import type { PluginApi } from '../../plugin-sdk/src/types';

import type { ContextMenuItem } from '../shared/context-menu-types';
import type { FileRef } from '../shared/file-table/file-ops';

type I18n = PluginApi['i18n'];

/**
 * .3mf — контейнер проекта, а не печатаемый формат (решение U): печать только
 * через инспектор, который извлекает встроенный G-code.
 */
export function is3mf(path: string): boolean {
  return /\.3mf$/i.test(path);
}

export function jobsMenuItems(
  i18n: I18n,
  ref: FileRef,
  isDir: boolean,
  klippyReady: boolean,
): ContextMenuItem[] {
  if (isDir) {
    return [
      { id: 'zip', label: i18n.t('jobs.zip'), icon: 'zip' },
      { id: 'rename', label: i18n.t('jobs.rename'), icon: 'rename' },
      { id: 'delete', label: i18n.t('jobs.delete'), icon: 'delete', danger: true },
    ];
  }

  // Для .3mf нет очереди, превью G-code, метаданных и текстового редактирования:
  // «печать» открывает инспектор (доступен и при неготовом Klipper — можно только загрузить).
  if (is3mf(ref.path)) {
    return [
      { id: 'print', label: i18n.t('jobs.open3mf'), icon: 'play' },
      { id: 'zip', label: i18n.t('jobs.zip'), icon: 'zip' },
      { id: 'download', label: i18n.t('jobs.download'), icon: 'download' },
      { id: 'rename', label: i18n.t('jobs.rename'), icon: 'rename' },
      { id: 'copy', label: i18n.t('jobs.copy'), icon: 'copy' },
      { id: 'delete', label: i18n.t('jobs.delete'), icon: 'delete', danger: true },
    ];
  }

  const printItem: ContextMenuItem = {
    id: 'print',
    label: i18n.t('jobs.print'),
    icon: 'play',
  };
  if (!klippyReady) {
    printItem.disabled = true;
    printItem.label = i18n.t('common.klipperNotReady');
  }

  return [
    printItem,
    { id: 'queue', label: i18n.t('jobs.queue'), icon: 'playlist-plus' },
    { id: 'edit', label: i18n.t('jobs.edit'), icon: 'edit' },
    { id: 'meta', label: i18n.t('jobs.meta'), icon: 'refresh' },
    { id: 'preview', label: i18n.t('jobs.preview'), icon: 'cube' },
    { id: 'zip', label: i18n.t('jobs.zip'), icon: 'zip' },
    { id: 'download', label: i18n.t('jobs.download'), icon: 'download' },
    { id: 'rename', label: i18n.t('jobs.rename'), icon: 'rename' },
    { id: 'copy', label: i18n.t('jobs.copy'), icon: 'copy' },
    { id: 'delete', label: i18n.t('jobs.delete'), icon: 'delete', danger: true },
  ];
}

/** Адрес страницы Jobs, которая сразу откроет 3MF-инспектор для файла. */
export function inspectUrl(printerId: string, path: string): string {
  return `#/p/${encodeURIComponent(printerId)}/jobs?inspect=${encodeURIComponent(path)}`;
}

export async function jobsCustomAction(
  api: PluginApi,
  ops: { startPrint: (r: FileRef) => Promise<void>; refreshMetadata: (r: FileRef) => Promise<void> },
  id: string,
  ref: FileRef,
  klippyReady: boolean,
): Promise<void> {
  if (id === 'print') {
    // .3mf не печатается напрямую: инспектор живёт на странице Jobs
    // (из виджета дашборда переходим на неё).
    if (is3mf(ref.path)) {
      globalThis.location.hash = inspectUrl(api.printer.id, ref.path);
      return;
    }
    // страховка от обхода disabled (клавиатура / programmatic):
    // печать не уходит к Moonraker при неактивном Klipper
    if (!klippyReady) return;
    await ops.startPrint(ref);
  } else if (id === 'queue') {
    // ref.path уже относительный к root; очередь принимает пути относительно gcodes root.
    // jobs-плагин работает с gcodes, но страхуемся:
    if (ref.root !== 'gcodes') {
      throw new Error('Queue accepts only gcode files');
    }
    if (is3mf(ref.path)) {
      throw new Error('3MF projects cannot be queued; extract the G-code first');
    }
    await api.moonraker().request('server.job_queue.post_job', {
      filenames: [ref.path],
      reset: false,
    });
    // Успех не сообщаем: виджет очереди live обновится через notify_job_queue_changed.
  } else if (id === 'preview') {
    globalThis.location.hash =
      `#/p/${api.printer.id}/gcode-preview?file=${encodeURIComponent(`${ref.root}/${ref.path}`)}`;
  } else if (id === 'meta') {
    await ops.refreshMetadata(ref);
  }
}
