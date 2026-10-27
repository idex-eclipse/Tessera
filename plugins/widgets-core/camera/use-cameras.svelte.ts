import { onDestroy } from 'svelte';

import type {
  PluginApi,
  PluginSettingsApi,
  MoonrakerProxyHandle,
} from '../../../plugin-sdk/src/types';
import {
  createCoreKeeper,
  createDelegateStore,
} from '../../shared/core-keeper/core-keeper';
import { cycleIndex, extractWebcams } from './camera-utils';

export interface WebcamItem {
  name: string;
  uid: string;
  source: string;
  location: string;
  service: string;
  target_fps: number;
  target_fps_idle: number;
  stream_url: string;
  snapshot_url: string;
  rotation: number;
  flip_horizontal: boolean;
  flip_vertical: boolean;
  enabled: boolean;
}

export const SERVICES = [
  'mjpegstreamer-adaptive',
  'mjpegstreamer',
  'uv4l-mjpeg',
  'hlsstream',
  'webrtc-camera',
  'go2rtc',
  'webrtc-mediamtx',
  'ipstream',
  'iframe',
];

function normalize(raw: any): WebcamItem {
  return {
    uid: String(raw?.uid ?? ''),
    source: String(raw?.source ?? 'database'),
    name: String(raw?.name ?? ''),
    location: String(raw?.location ?? 'printer'),
    service: String(raw?.service ?? 'mjpegstreamer-adaptive'),
    target_fps: Number(raw?.target_fps ?? 15),
    target_fps_idle: Number(raw?.target_fps_idle ?? 5),
    stream_url: String(raw?.stream_url ?? '/webcam/?action=stream'),
    snapshot_url: String(raw?.snapshot_url ?? '/webcam/?action=snapshot'),
    rotation: Number(raw?.rotation ?? 0),
    flip_horizontal: Boolean(raw?.flip_horizontal),
    flip_vertical: Boolean(raw?.flip_vertical),
    enabled: raw?.enabled !== false,
  };
}

// ------------------------------------------------------------------
// Module-level: UI-стор страницы управления камерами (диалоги CRUD) —
// общий для legacy-потребителей; fleet-панели диалоги не открывают.
// Сбрасываются при смене активного принтера (legacy-ветка хука).
// ------------------------------------------------------------------
let dialog = $state<null | { mode: 'add' } | { mode: 'edit'; item: WebcamItem }>(null);
let toDelete = $state<WebcamItem | null>(null);

// ------------------------------------------------------------------
// Core factory: ядро СТАТИЧЕСКИ привязано к принтеру.
// Legacy-режим (без printerId) = делегат, следующий за активным принтером.
// Fleet-режим (с printerId) = прямое ядро с удержанием.
// ------------------------------------------------------------------
function createCamerasCore(api: PluginApi, printerId: string) {
  const settingsApi: PluginSettingsApi = api.settingsFor(printerId);

  let cameras = $state<WebcamItem[]>([]);
  let activeName = $state<string | null>(null);

  let generation = 0;
  const unsubs: Array<() => void> = [];

  function safeHandle(): MoonrakerProxyHandle | null {
    try {
      return api.moonrakerFor(printerId);
    } catch {
      return null;
    }
  }

  // false — форма ответа не распознана, список не тронут
  function applyList(raw: unknown): boolean {
    const arr = extractWebcams(raw);
    if (!arr) return false;
    cameras = arr.filter((c: any) => c && c.name).map(normalize);
    return true;
  }

  async function loadList(gen: number): Promise<void> {
    const h = safeHandle();
    if (!h) return;
    const res = await h.request<any>('server.webcams.list').catch(() => null);
    if (gen !== generation) return;
    if (res) applyList(res);
  }

  let enabled = $derived(cameras.filter((c) => c.enabled));

  let active = $derived(
    enabled.find((c) => c.name === activeName) ?? enabled[0] ?? null,
  );

  // setActive пишет в namespace своего принтера через settingsFor(printerId)
  function setActive(name: string): void {
    activeName = name;
    settingsApi.set('camera.active', name);
  }

  // Листание по кругу среди включённых камер
  function step(delta: number): void {
    if (enabled.length < 2) return;
    const cur = enabled.findIndex((c) => c.name === active?.name);
    const next = enabled[cycleIndex(cur < 0 ? 0 : cur, delta, enabled.length)];
    if (next) setActive(next.name);
  }

  // CRUD — используется только legacy-UI (CameraPage). Fleet-панели не
  // открывают диалоги, поэтому безопасный handle берётся через api.moonraker()
  // активного принтера (не moonrakerFor(printerId) ядра).
  async function saveCamera(item: WebcamItem, isNew: boolean): Promise<void> {
    let h: MoonrakerProxyHandle;
    try {
      h = api.moonraker();
    } catch {
      return;
    }

    const params: Record<string, unknown> = {
      name: item.name,
      location: item.location,
      service: item.service,
      target_fps: item.target_fps,
      target_fps_idle: item.target_fps_idle,
      stream_url: item.stream_url,
      snapshot_url: item.snapshot_url,
      flip_horizontal: item.flip_horizontal,
      flip_vertical: item.flip_vertical,
      rotation: item.rotation,
      enabled: item.enabled,
    };
    if (!isNew && item.uid) params.uid = item.uid;

    // при ошибке диалог остаётся открытым — введённые данные не теряем
    const ok = await h
      .request('server.webcams.post_item', params)
      .then(() => true)
      .catch((e) => {
        console.error('[camera] save failed:', e);
        return false;
      });
    if (!ok) return;
    dialog = null;
    await loadList(generation);
  }

  async function deleteCamera(item: WebcamItem): Promise<void> {
    let h: MoonrakerProxyHandle;
    try {
      h = api.moonraker();
    } catch {
      return;
    }
    const ok = await h
      .request('server.webcams.delete_item', item.uid ? { uid: item.uid } : { name: item.name })
      .then(() => true)
      .catch((e) => {
        console.error('[camera] delete failed:', e);
        return false;
      });
    if (!ok) return;
    toDelete = null;
    await loadList(generation);
  }

  const openAdd = () => (dialog = { mode: 'add' });
  const openEdit = (item: WebcamItem) => (dialog = { mode: 'edit', item });
  const askDelete = (item: WebcamItem) => (toDelete = item);
  const closeDialog = () => (dialog = null);
  const closeDelete = () => (toDelete = null);

  // Lifecycle

  function teardown(): void {
    generation++;
    for (const u of unsubs.splice(0)) u();
  }

  async function init(): Promise<void> {
    const gen = ++generation;

    // Читаем сохранённый выбор из namespace принтера
    activeName = settingsApi.get<string>('camera.active') ?? null;

    unsubs.push(
      settingsApi.onChange((k, v) => {
        if (k === 'camera.active') activeName = typeof v === 'string' ? v : null;
      }),
    );

    const h = safeHandle();
    if (!h) return;

    unsubs.push(h.onReady(() => {
      if (gen === generation) void loadList(gen);
    }));
    unsubs.push(h.onNotify('notify_webcams_changed', (p: any) => {
      if (gen !== generation) return;
      // params приходят массивом-обёрткой [{ webcams }]; не поняли форму — перечитываем
      if (!applyList(p)) void loadList(gen);
    }));

    await loadList(gen);
  }

  init();

  function destroy(): void {
    teardown();
  }

  return {
    get cameras() { return cameras; },
    get enabled() { return enabled; },
    get active() { return active; },
    get dialog() { return dialog; },
    get toDelete() { return toDelete; },
    setActive,
    step,
    saveCamera,
    deleteCamera,
    openAdd,
    openEdit,
    askDelete,
    closeDialog,
    closeDelete,
    destroy,
  };
}

export type CamerasStore = ReturnType<typeof createCamerasCore>;

// ------------------------------------------------------------------
// Keeper: ядра живут per-printer, переживают unmount (keep-alive).
// ------------------------------------------------------------------
const keeper = createCoreKeeper<CamerasStore>({
  create: (pid, api) => createCamerasCore(api, pid),
  cap: 4,
});

/**
 * Хук камер.
 *
 * Без printerId — legacy: делегирующий store, следующий за активным принтером;
 * refcount на текущего принтера, ядра других принтеров живут в keeper по
 * политике keep-alive. С printerId — fleet: прямое ядро с удержанием.
 *
 * Диалоги CRUD (module-level) сбрасываются при смене активного принтера
 * (legacy-ветка), потому что они привязаны к активному принтеру через
 * api.moonraker().
 */
export function useCameras(api: PluginApi, printerId?: string): CamerasStore {
  if (printerId !== undefined) {
    const core = keeper.acquire(printerId, api);
    const offPrinters = api.onPrintersChange((printers) => {
      keeper.prune(printers.map((p) => p.id));
    });
    onDestroy(() => {
      offPrinters();
      keeper.release(printerId);
    });
    return core;
  }

  let heldPid = api.printer.id;
  keeper.acquire(heldPid, api);

  const offPrinter = api.onPrinterChange((p) => {
    keeper.release(heldPid);
    heldPid = p.id;
    keeper.acquire(heldPid, api);
    // Сбрасываем диалоги страницы — они относились к предыдущему принтеру
    dialog = null;
    toDelete = null;
  });

  const offPrinters = api.onPrintersChange((printers) => {
    keeper.prune(printers.map((p) => p.id));
  });

  onDestroy(() => {
    offPrinter();
    offPrinters();
    keeper.release(heldPid);
  });

  // Делегат: каждое чтение уходит в ядро ТЕКУЩЕГО активного принтера;
  // сигнал api.printer.id даёт реактивность смены вкладки.
  return createDelegateStore<CamerasStore>(() => keeper.get(api.printer.id, api));
}