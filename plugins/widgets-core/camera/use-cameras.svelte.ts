import { onDestroy } from 'svelte';

import type {
  PluginApi,
  PluginSettingsApi,
  MoonrakerProxyHandle,
} from '../../../plugin-sdk/src/types';

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
// fleetCache — мгновенная отрисовка списка камер при remount (общий).
// ------------------------------------------------------------------
let dialog = $state<null | { mode: 'add' } | { mode: 'edit'; item: WebcamItem }>(null);
let toDelete = $state<WebcamItem | null>(null);
const fleetCache = new Map<string, WebcamItem[]>();

// ------------------------------------------------------------------
// Core factory: изолированное ядро на (api, printerId | null).
// Legacy (printerId === null) — refcounted singleton core, виджет камеры
// и диалоги делят один core.
// Fleet (printerId !== null) — изолированный core; настройки (camera.active)
// читаются/пишутся в namespace принтера через api.settingsFor(printerId).
// ------------------------------------------------------------------
function createCamerasCore(api: PluginApi, printerId: string | null) {
  const fleet = printerId !== null;
  const settingsApi: PluginSettingsApi = fleet
    ? api.settingsFor(printerId as string)
    : api.settings;

  let cameras = $state<WebcamItem[]>([]);
  let activeName = $state<string | null>(null);

  let generation = 0;
  const unsubs: Array<() => void> = [];

  function safeHandle(): MoonrakerProxyHandle | null {
    try {
      return fleet ? api.moonrakerFor(printerId as string) : api.moonraker();
    } catch {
      return null;
    }
  }

  function applyList(raw: any): void {
    const arr = Array.isArray(raw) ? raw : (raw?.webcams ?? []);
    const list = arr.filter((c: any) => c && c.name).map(normalize);
    cameras = list;
    if (fleet) fleetCache.set(printerId as string, list);
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

  // setActive одинаково работает для legacy и fleet: настройки пишутся в
  // namespace своего принтера (legacy = activePrinterId, fleet = printerId).
  function setActive(name: string): void {
    activeName = name;
    settingsApi.set('camera.active', name);
  }

  // CRUD — используется только legacy-UI (CameraPage). Fleet-панели не
  // открывают диалоги, поэтому безопасный handle берётся через api.moonraker()
  // активного принтера в legacy-режиме.
  async function saveCamera(item: WebcamItem, isNew: boolean): Promise<void> {
    const h = safeHandle();
    if (!h) return;

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

    await h
      .request('server.webcams.post_item', params)
      .catch((e) => console.error('[camera] save failed:', e));
    dialog = null;
    await loadList(generation);
  }

  async function deleteCamera(item: WebcamItem): Promise<void> {
    const h = safeHandle();
    if (!h) return;
    await h
      .request('server.webcams.delete_item', item.uid ? { uid: item.uid } : { name: item.name })
      .catch((e) => console.error('[camera] delete failed:', e));
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

    // И legacy и fleet читают сохранённый выбор из своего namespace
    activeName = settingsApi.get<string>('camera.active') ?? null;

    // Fleet: мгновенная отрисовка из кэша (до ответа loadList)
    if (fleet) {
      const cached = fleetCache.get(printerId as string);
      if (cached) cameras = cached;
    }

    unsubs.push(
      settingsApi.onChange((k, v) => {
        if (k === 'camera.active') activeName = typeof v === 'string' ? v : null;
      }),
    );

    const h = safeHandle();
    if (!h) return;
    if (!fleet && !api.printer.url) return;

    unsubs.push(h.onReady(() => {
      if (gen === generation) void loadList(gen);
    }));
    unsubs.push(h.onNotify('notify_webcams_changed', (p: any) => {
      if (gen === generation) applyList(p);
    }));

    await loadList(gen);
  }

  init();

  let offPrinter: () => void = () => {};

  if (!fleet) {
    offPrinter = api.onPrinterChange(() => {
      teardown();
      cameras = [];
      activeName = null;
      // Сбрасываем диалоги страницы — они относились к предыдущему принтеру
      dialog = null;
      toDelete = null;
      void init();
    });
  }

  function destroy(): void {
    offPrinter();
    teardown();
  }

  return {
    get cameras() { return cameras; },
    get enabled() { return enabled; },
    get active() { return active; },
    get dialog() { return dialog; },
    get toDelete() { return toDelete; },
    setActive,
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
// Legacy: refcounted singleton core. Виджет камеры и диалоги страницы
// делят один core (список камер/выбор/подписки общие). Fleet-инстансы
// изолированы через createCamerasCore(api, pid).
// ------------------------------------------------------------------
let legacyCore: CamerasStore | null = null;
let legacyConsumers = 0;

function legacyCoreAcquire(api: PluginApi): CamerasStore {
  if (!legacyCore) legacyCore = createCamerasCore(api, null);
  legacyConsumers++;
  return legacyCore;
}

function legacyCoreRelease(): void {
  legacyConsumers--;
  if (legacyConsumers > 0 || !legacyCore) return;
  legacyCore.destroy();
  legacyCore = null;
}

/**
 * Хук камер.
 *
 * Без printerId — legacy: shared core активного принтера (refcounted;
 * виджет камеры и диалоги страницы делят один core). Выбор камеры
 * персистится в namespace активного принтера.
 *
 * С printerId — fleet: изолированный core на принтер, handle через
 * api.moonrakerFor(printerId), выбор камеры персистится в namespace
 * указанного принтера через api.settingsFor(printerId).
 */
export function useCameras(api: PluginApi, printerId?: string): CamerasStore {
  if (printerId === undefined) {
    const core = legacyCoreAcquire(api);
    onDestroy(() => legacyCoreRelease());
    return core;
  }

  const core = createCamerasCore(api, printerId);
  onDestroy(() => core.destroy());
  return core;
}