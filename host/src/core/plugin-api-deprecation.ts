import type { PluginManifest } from '../../../plugin-sdk/src/types';
import { PLUGIN_API, LEGACY_PLUGIN_API, LAST_LEGACY_PLUGIN_API, formatPluginApi, parsePluginApi } from '../../../plugin-sdk/src/api-level';
import type { LoadedPlugin } from './plugin-loader.svelte';
import type { RemotePluginRecord } from './types';
import type { NotificationCenter } from './notification-center.svelte';
import { HOST_NOTIFICATION_SOURCE } from './notification-center.svelte';
import type { HostI18n } from './host-i18n.svelte';
import type { StorageLike } from './storage';

/** Per-browser host notice ledger; plugin settings are mirrored, but this acknowledgement is not. */
export const HOST_NOTICE_STORAGE_KEY = 'mpu:v2:host-notices';
const LEGACY_NOTICE_KEY = 'plugin-api-0.x';

/** A host notice can reuse this ledger without adding another UI settings field. */
export function publishHostNoticeOnce(
  storage: Pick<StorageLike, 'getItem' | 'setItem'>,
  key: string,
  fingerprint: string,
  publish: () => void,
): void {
  let ledger: Record<string, string> = {};
  try {
    const raw: unknown = JSON.parse(storage.getItem(HOST_NOTICE_STORAGE_KEY) ?? '{}');
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      ledger = Object.fromEntries(Object.entries(raw).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
    }
  } catch {
    // Storage may be unavailable or contain old corrupt data; the notice still reaches the user.
  }
  if (ledger[key] === fingerprint) return;
  if (fingerprint) publish();
  ledger[key] = fingerprint;
  try { storage.setItem(HOST_NOTICE_STORAGE_KEY, JSON.stringify(ledger)); } catch { /* Private browsing may deny persistence. */ }
}

/** The previous contract is accepted only during the 1.0 migration window. */
export function isDeprecatedPluginApi(value: unknown): boolean {
  const parsed = parsePluginApi(value);
  const first = parsePluginApi(LEGACY_PLUGIN_API)!;
  const last = parsePluginApi(LAST_LEGACY_PLUGIN_API)!;
  return PLUGIN_API === '1.0' && parsed?.[0] === 0 && parsed[1] >= first[1] && parsed[1] <= last[1];
}

/** Host dependencies are injected so checks work with disabled plugins and offline cache in tests. */
export interface PluginApiDeprecationDeps {
  records: readonly RemotePluginRecord[];
  loaded: readonly LoadedPlugin[];
  readManifest: (url: string) => Promise<PluginManifest>;
  rememberApi: (url: string, version: string, name: string) => void;
  notifications: Pick<NotificationCenter, 'push'>;
  i18n: Pick<HostI18n, 't'>;
  storage: Pick<StorageLike, 'getItem' | 'setItem'>;
  isCurrent?: () => boolean;
}

/** Warn once per browser and installed legacy set, including disabled plugins. */
export async function checkDeprecatedPluginApis(deps: PluginApiDeprecationDeps): Promise<void> {
  const loadedByUrl = new Map(deps.loaded.filter((plugin) => plugin.source === 'remote' && plugin.manifestUrl)
    .map((plugin) => [plugin.manifestUrl, plugin.manifest]));
  const legacy = await Promise.all(deps.records.map(async (record) => {
    let manifest = loadedByUrl.get(record.manifestUrl);
    if (!manifest && !record.enabled) {
      try { manifest = await deps.readManifest(record.manifestUrl); } catch { /* Use the last verified declaration. */ }
    }
    const api = manifest ? formatPluginApi(manifest.pluginApi) : record.pluginApi;
    const name = manifest?.name ?? record.pluginName ?? record.manifestUrl;
    if (manifest && api && parsePluginApi(api)) deps.rememberApi(record.manifestUrl, api, name);
    return api !== undefined && isDeprecatedPluginApi(api) ? { url: record.manifestUrl, name } : null;
  }));
  if (deps.isCurrent && !deps.isCurrent()) return;
  const found = legacy.filter((item): item is { url: string; name: string } => item !== null);
  const fingerprint = JSON.stringify(found.map((item) => item.url).sort());
  if (found.length === 0) {
    publishHostNoticeOnce(deps.storage, LEGACY_NOTICE_KEY, '', () => {});
    return;
  }
  // Keep the next-release warning visible under the notification center's 240-character cap.
  const names = found.slice(0, 3).map((item) => item.name.slice(0, 22)).join(', ');
  const extra = found.length - Math.min(found.length, 3);
  const list = extra > 0 ? deps.i18n.t('notifications.deprecated.more', { names, extra }) : names;
  publishHostNoticeOnce(deps.storage, LEGACY_NOTICE_KEY, fingerprint, () => {
    deps.notifications.push({
      printerId: '',
      pluginId: HOST_NOTIFICATION_SOURCE,
      severity: 'info',
      label: deps.i18n.t('notifications.deprecated.source'),
      text: deps.i18n.t('notifications.deprecated.plugins', { list }),
      actions: [{ kind: 'host-settings', section: 'plugins' }],
    });
  });
}
