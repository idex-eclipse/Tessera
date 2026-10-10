import type { PluginApi } from '../../plugin-sdk/src/types';

import type { ContextMenuItem } from '../shared/context-menu.svelte';
import type { FileRef } from '../shared/file-table/file-ops';

type I18n = PluginApi['i18n'];

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

export async function jobsCustomAction(
  api: PluginApi,
  ops: { startPrint: (r: FileRef) => Promise<void>; refreshMetadata: (r: FileRef) => Promise<void> },
  id: string,
  ref: FileRef,
  klippyReady: boolean,
): Promise<void> {
  if (id === 'print') {
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