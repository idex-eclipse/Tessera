import { onDestroy } from 'svelte';

import type { PluginApi, MoonrakerProxyHandle } from '../../../plugin-sdk/src/types';

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
// Module-state: LEGACY-поток (активный принтер). Виджет камеры и
// диалоги управления шарят его, как раньше.
// ------------------------------------------------------------------
let cameras = $state<WebcamItem[]>([]);
let activeName = $state<string | null>(null);
let dialog = $state<null | { mode: 'add' } | { mode: 'edit'; item: WebcamItem }>(null);
let toDelete = $state<WebcamItem | null>(null);
const fleetCache = new Map<string, WebcamItem[]>();

/**
 * Хук камер.
 *
 * Без printerId — прежнее поведение: активный принтер, module-state,
 * ресет/реинициализация на onPrinterChange, персист выбора в api.settings.
 *
 * С printerId — fleet-режим: instance-local state (N панелей = N независимых
 * сторов), статическая привязка к принтеру (onPrinterChange НЕ слушается),
 * выбор камеры НЕ персистится (namespace api.settings привязан к активному
 * принтеру — осознанный пробел v1).
 */
export function useCameras(api: PluginApi, printerId?: string) {
  const fleet = printerId !== undefined;

  // Fleet: состояние экземпляра.
  let localCameras = $state<WebcamItem[]>([]);
  let localActiveName = $state<string | null>(null);

  const getCameras = (): WebcamItem[] => (fleet ? localCameras : cameras);
  const setCameras = (v: WebcamItem[]): void => {
    if (fleet) localCameras = v;
    else cameras = v;
  };
  const getActiveName = (): string | null => (fleet ? localActiveName : activeName);
  const setActiveName = (v: string | null): void => {
    if (fleet) localActiveName = v;
    else activeName = v;
  };

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
    setCameras(arr.filter((c: any) => c && c.name).map(normalize));
    if (fleet) fleetCache.set(printerId as string, getCameras());
  }

  async function loadList(gen: number): Promise<void> {
    const h = safeHandle();
    if (!h) return;
    const res = await h.request<any>('server.webcams.list').catch(() => null);
    if (gen !== generation) return;
    if (res) applyList(res);
  }

  let enabled = $derived(getCameras().filter((c) => c.enabled));

  let active = $derived(
    enabled.find((c) => c.name === getActiveName()) ?? enabled[0] ?? null,
  );

  function setActive(name: string): void {
    setActiveName(name);
    if (!fleet) api.settings.set('camera.active', name);
  }

  // CRUD (стандартный Moonraker Webcams API) — используется только legacy-UI
  // управления; fleet-панель диалоги не открывает.
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
    if (!fleet) setActiveName(api.settings.get<string>('camera.active') ?? null);

    const h = safeHandle();
    if (!h) return;
    if (!fleet && !api.printer.url) return;

    unsubs.push(h.onReady(() => {
      if (gen === generation) void loadList(gen);
    }));
    unsubs.push(h.onNotify('notify_webcams_changed', (p: any) => {
      if (gen === generation) applyList(p);
    }));

    if (fleet) {
      const cached = fleetCache.get(printerId as string);
      if (cached) setCameras(cached);
    }

    await loadList(gen);
  }

  init();

  if (fleet) {
    onDestroy(() => {
      teardown();
    });
  } else {
    const offSettings = api.settings.onChange((k, v) => {
      if (k === 'camera.active') activeName = typeof v === 'string' ? v : null;
    });

    const offPrinter = api.onPrinterChange(() => {
      teardown();
      cameras = [];
      activeName = null;
      dialog = null;
      toDelete = null;
      void init();
    });

    onDestroy(() => {
      teardown();
      offSettings();
      offPrinter();
    });
  }

  return {
    get cameras() { return getCameras(); },
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
  };
}

export type CamerasStore = ReturnType<typeof useCameras>;