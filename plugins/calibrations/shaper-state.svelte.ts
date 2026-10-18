import type { PluginApi, MoonrakerProxyHandle } from '../../plugin-sdk/src/types';

export interface FittedRow {
  name: string;
  freq: number;
  vib: number;
  smooth: number;
}

export interface ShaperState {
  axis: 'X' | 'Y';
  freqStart: string;
  freqEnd: string;
  hzPerSec: string;
  shaperTypes: string;
  external: boolean;

  // Settings-поля (персист через api.settings, не сбрасываются)
  cmd: Record<'X' | 'Y', string>;
  beltsEnabled: boolean;
  kinematics: 'auto' | 'corexy' | 'delta';
  beltsCmd: string;
  beltsForceShow: boolean;

  // Run-состояние (сбрасывается на klippy_ready/printer change)
  busy: string;
  runDone: boolean;
  sessionLog: string[];
  fitted: FittedRow[];
  recommended: { name: string; freq: number } | null;
  gallery: Record<string, number>;
  galleryLoaded: boolean;
  selected: string | null;
  previewUrl: string | null;
  lastArtifacts: string[];
  beltLog: string[];
  beltArtifacts: string[];

  // Baseline для diff артефактов (private для ядра)
  baseline: Record<string, number> | null;
}

export function initialShaperState(): ShaperState {
  return {
    axis: 'X',
    freqStart: '',
    freqEnd: '',
    hzPerSec: '',
    shaperTypes: '',
    external: false,
    cmd: { X: '', Y: '' },
    beltsEnabled: false,
    kinematics: 'auto',
    beltsCmd: '',
    beltsForceShow: false,
    busy: '',
    runDone: false,
    sessionLog: [],
    fitted: [],
    recommended: null,
    gallery: {},
    galleryLoaded: false,
    selected: null,
    previewUrl: null,
    lastArtifacts: [],
    beltLog: [],
    beltArtifacts: [],
    baseline: null,
  };
}

/** Сброс run-состояния; settings-поля (cmd/beltsEnabled/kinematics/beltsCmd)
 *  НЕ сбрасываются — компоненты перечитают их из api.settings на onPrinterChange. */
export function resetShaperState(state: ShaperState): void {
  state.axis = 'X';
  state.freqStart = '';
  state.freqEnd = '';
  state.hzPerSec = '';
  state.shaperTypes = '';
  state.busy = '';
  state.runDone = false;
  state.sessionLog = [];
  state.fitted = [];
  state.recommended = null;
  state.gallery = {};
  state.galleryLoaded = false;
  state.selected = null;
  state.lastArtifacts = [];
  state.beltLog = [];
  state.beltArtifacts = [];
  state.baseline = null;
  releasePreview(state);
}

export function releasePreview(state: ShaperState): void {
  if (state.previewUrl) {
    URL.revokeObjectURL(state.previewUrl);
    state.previewUrl = null;
  }
}

interface ListFile {
  filename: string;
  modified: number;
}

/** Union png: корень config + подпапка shapers/.
 *  Чистая функция, принимает handle. */
export async function listPngs(handle: MoonrakerProxyHandle): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  const targets: Array<{ path?: string; prefix: string }> = [
    { prefix: '' },
    { path: 'shapers', prefix: 'shapers/' },
  ];
  for (const t of targets) {
    try {
      const params: Record<string, unknown> = { root: 'config' };
      if (t.path) params.path = t.path;
      const res = await handle.request<{ files?: ListFile[] }>('server.files.list', params);
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

export async function refreshGallery(state: ShaperState, handle: MoonrakerProxyHandle): Promise<void> {
  state.gallery = await listPngs(handle);
  state.galleryLoaded = true;
  if (state.selected && !(state.selected in state.gallery)) {
    state.selected = null;
    releasePreview(state);
  }
}

export function takeBaseline(state: ShaperState): void {
  state.baseline = { ...state.gallery };
}

/** Новые/изменённые png после прогона (без часов сервера, без clock skew). */
export function diffArtifacts(state: ShaperState): string[] {
  const base = state.baseline ?? {};
  const out: string[] = [];
  for (const [path, modified] of Object.entries(state.gallery)) {
    const b = base[path];
    if (b === undefined || modified > b) out.push(path);
  }
  return out.sort();
}

export function gallerySorted(state: ShaperState): Array<{ path: string; modified: number; tag: 'X' | 'Y' | null }> {
  return Object.entries(state.gallery)
    .map(([path, modified]) => ({ path, modified, tag: axisTag(path) }))
    .sort((a, b) => b.modified - a.modified);
}

export function axisTag(path: string): 'X' | 'Y' | null {
  const base = path.split('/').pop() ?? path;
  if (/(^|[_-])x([._-]|$)/i.test(base)) return 'X';
  if (/(^|[_-])y([._-]|$)/i.test(base)) return 'Y';
  return null;
}

/** Превью: fetch no-store + blob + objectURL; revoke на смене выбора и unmount. */
export async function loadPreview(state: ShaperState, handle: MoonrakerProxyHandle, path: string): Promise<void> {
  releasePreview(state);
  state.selected = path;
  try {
    const headers: Record<string, string> = {};
    if (handle.authToken) headers.Authorization = `Bearer ${handle.authToken}`;
    const rel = path.split('/').map(encodeURIComponent).join('/');
    const res = await fetch(`${handle.httpBaseUrl}/server/files/config/${rel}`, {
      headers,
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    state.previewUrl = URL.createObjectURL(blob);
  } catch (e) {
    console.error('[calibrations] preview fetch failed:', path, e);
    state.previewUrl = null;
  }
}