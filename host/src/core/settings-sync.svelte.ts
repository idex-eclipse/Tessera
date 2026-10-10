const PREF_KEY = 'mpu:v2:settingsSync';

interface Prefs {
  plugins: Record<string, boolean>;
  dashboard: boolean;
}

function load(): Prefs {
  try {
    const raw = localStorage.getItem(PREF_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<Prefs>;
      return { plugins: p.plugins ?? {}, dashboard: !!p.dashboard };
    }
  } catch { /* ignore */ }
  return { plugins: {}, dashboard: false }; // дефолт ВЫКЛ
}

let prefs = $state<Prefs>(load());

const syncSubs = new Set<() => void>();

function persist(): void {
  localStorage.setItem(PREF_KEY, JSON.stringify(prefs));
  syncSubs.forEach((cb) => cb());
}

export function onSyncChange(cb: () => void): () => void {
  syncSubs.add(cb);
  return () => { syncSubs.delete(cb); };
}

export function isPluginSynced(pluginId: string): boolean {
  return prefs.plugins[pluginId] ?? false;
}
export function isDashboardSynced(): boolean {
  return prefs.dashboard;
}

// ---------- ключи хранения ----------

export function pluginSettingsKey(printerId: string, pluginId: string): string {
  return isPluginSynced(pluginId)
    ? `mpu:v2:plugin-settings:GLOBAL:${pluginId}`
    : `mpu:v2:plugin-settings:${printerId}:${pluginId}`;
}

export function printerSettingsKey(printerId: string): string {
  return isDashboardSynced()
    ? 'mpu:v2:settings:GLOBAL'
    : `mpu:v2:settings:${printerId}`;
}

// ---------- чтение/запись (для миграции) ----------

function readJson(key: string): Record<string, unknown> | undefined {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : undefined;
  } catch { return undefined; }
}
function writeJson(key: string, v: unknown): void {
  localStorage.setItem(key, JSON.stringify(v));
}

// ---------- тумблеры с миграцией без потерь ----------

export function setPluginSynced(printerId: string, pluginId: string, on: boolean): void {
  if (isPluginSynced(pluginId) === on) return;
  const per = `mpu:v2:plugin-settings:${printerId}:${pluginId}`;
  const glob = `mpu:v2:plugin-settings:GLOBAL:${pluginId}`;
  if (on) {
    if (!readJson(glob)) { const p = readJson(per); if (p) writeJson(glob, p); }
  } else {
    const g = readJson(glob); if (g) writeJson(per, g);
  }
  prefs = { ...prefs, plugins: { ...prefs.plugins, [pluginId]: on } };
  persist();
}

export function setDashboardSynced(printerId: string, on: boolean): void {
  if (isDashboardSynced() === on) return;
  const per = `mpu:v2:settings:${printerId}`;
  const glob = 'mpu:v2:settings:GLOBAL';
  if (on) {
    if (!readJson(glob)) { const p = readJson(per); if (p) writeJson(glob, p); }
  } else {
    const g = readJson(glob); if (g) writeJson(per, g);
  }
  prefs = { ...prefs, dashboard: on };
  persist();
}