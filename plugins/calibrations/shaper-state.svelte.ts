import type { PluginApi } from '../../plugin-sdk/src/types';

export interface FittedRow {
  name: string;
  freq: number;
  vib: number;
  smooth: number;
}

/** Module-state панели shaper + секции belts. Живёт между ремонтами контента,
 *  run-поля сбрасываются на onPrinterChange (вызывает resetShaperState);
 *  settings-поля (cmd / beltsEnabled / kinematics / beltsCmd) НЕ сбрасываются —
 *  их перечитывают компоненты из api.settings (sync-aware). */
export const shaper = $state({
  axis: 'X' as 'X' | 'Y',
  freqStart: '',
  freqEnd: '',
  hzPerSec: '',
  shaperTypes: '',
  external: false,

  // --- Settings-поля (персист через api.settings, не сбрасываются) ---
  cmd: { X: '', Y: '' } as Record<'X' | 'Y', string>,
  beltsEnabled: false,
  kinematics: 'auto' as 'auto' | 'corexy' | 'delta',
  beltsCmd: '',
  beltsForceShow: false,   // force-показ панели Belts независимо от детекта кинематики

  // --- Run-состояние (сбрасывается на onPrinterChange) ---
  busy: '',
  runDone: false,
  sessionLog: [] as string[],
  fitted: [] as FittedRow[],
  recommended: null as { name: string; freq: number } | null,
  gallery: {} as Record<string, number>,   // path (относительно config-рута) → modified
  galleryLoaded: false,
  selected: null as string | null,
  previewUrl: null as string | null,
  lastArtifacts: [] as string[],

  // Belts (по документации Klipper — один сравнительный png, плоские массивы).
  beltLog: [] as string[],
  beltArtifacts: [] as string[],
});

/** Снимок листингов ДО прогона — база диффа артефактов.
 *  Общий для shaper- и belts-пайплайнов (оба пишут в ту же галерею). */
let baseline: Record<string, number> | null = null;

export function resetShaperState(): void {
  shaper.axis = 'X';
  shaper.freqStart = '';
  shaper.freqEnd = '';
  shaper.hzPerSec = '';
  shaper.shaperTypes = '';
  shaper.busy = '';
  shaper.runDone = false;
  shaper.sessionLog = [];
  shaper.fitted = [];
  shaper.recommended = null;
  shaper.gallery = {};
  shaper.galleryLoaded = false;
  shaper.selected = null;
  shaper.lastArtifacts = [];
  shaper.beltLog = [];
  shaper.beltArtifacts = [];
  releasePreview();
  baseline = null;
  // cmd / beltsEnabled / kinematics / beltsCmd — НЕ сбрасываем:
  // компоненты перечитают их из api.settings на onPrinterChange (sync-aware).
}

export function releasePreview(): void {
  if (shaper.previewUrl) {
    URL.revokeObjectURL(shaper.previewUrl);
    shaper.previewUrl = null;
  }
}

interface ListFile {
  filename: string;
  modified: number;
}

/** Union png: корень config + подпапка shapers/ (покрывает оба расположения).
 *  Галерея общая для shaper и belts. */
async function listPngs(api: PluginApi): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  const targets: Array<{ path?: string; prefix: string }> = [
    { prefix: '' },
    { path: 'shapers', prefix: 'shapers/' },
  ];
  for (const t of targets) {
    try {
      const params: Record<string, unknown> = { root: 'config' };
      if (t.path) params.path = t.path;
      const res = await api
        .moonraker()
        .request<{ files?: ListFile[] }>('server.files.list', params);
      for (const f of res?.files ?? []) {
        const name = String(f.filename ?? '');
        if (!name.toLowerCase().endsWith('.png')) continue;
        out[t.prefix + name] = Number(f.modified ?? 0);
      }
    } catch (e) {
      console.error('[calibrations] server.files.list failed:', t.path ?? '', e);
    }
  }
  return out;
}

export async function refreshGallery(api: PluginApi): Promise<void> {
  shaper.gallery = await listPngs(api);
  shaper.galleryLoaded = true;
  if (shaper.selected && !(shaper.selected in shaper.gallery)) {
    shaper.selected = null;
    releasePreview();
  }
}

export function takeBaseline(): void {
  baseline = { ...shaper.gallery };
}

/** Новые/изменённые png после прогона (без часов сервера, без clock skew). */
export function diffArtifacts(): string[] {
  const base = baseline ?? {};
  const out: string[] = [];
  for (const [path, modified] of Object.entries(shaper.gallery)) {
    const b = base[path];
    if (b === undefined || modified > b) out.push(path);
  }
  return out.sort();
}

export function gallerySorted(): Array<{ path: string; modified: number; tag: 'X' | 'Y' | null }> {
  return Object.entries(shaper.gallery)
    .map(([path, modified]) => ({ path, modified, tag: axisTag(path) }))
    .sort((a, b) => b.modified - a.modified);
}

/** Эвристика тега оси по имени файла.
 *  Покрывает shaper (x/y в имени) и belts (belts.png от graph_accelerometer — без тега). */
export function axisTag(path: string): 'X' | 'Y' | null {
  const base = path.split('/').pop() ?? path;
  if (/(^|[_-])x([._-]|$)/i.test(base)) return 'X';
  if (/(^|[_-])y([._-]|$)/i.test(base)) return 'Y';
  return null;
}

/** Превью: fetch no-store (имена файлов фиксированные → иначе stale-png)
 *  + blob + objectURL; revoke на смене выбора и unmount.
 *  Общий для shaper-галереи и belts-артефактов. */
export async function loadPreview(api: PluginApi, path: string): Promise<void> {
  releasePreview();
  shaper.selected = path;
  try {
    const h = api.moonraker();
    const headers: Record<string, string> = {};
    if (h.authToken) headers.Authorization = `Bearer ${h.authToken}`;
    const rel = path.split('/').map(encodeURIComponent).join('/');
    const res = await fetch(`${h.httpBaseUrl}/server/files/config/${rel}`, {
      headers,
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    shaper.previewUrl = URL.createObjectURL(blob);
  } catch (e) {
    console.error('[calibrations] preview fetch failed:', path, e);
    shaper.previewUrl = null;
  }
}