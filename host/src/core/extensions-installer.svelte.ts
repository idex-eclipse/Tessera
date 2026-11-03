import { satisfiesMin } from '../../../plugin-sdk/src/dependencies.ts';

import { absoluteManifestUrl } from './extensions-catalog.svelte.ts';

/**
 * Установка плагинов из UI: клиент службы tessera-ext (deploy/tessera-ext.py serve)
 * за nginx на /tessera-api/v1/.
 *
 * Служба необязательна. Нет службы (выключена, dev-сервер, ручная настройка nginx) →
 * available = false, UI эту возможность не показывает, плагины ставятся через CLI.
 * Клиент передаёт только id плагина: что и откуда ставить, решает служба по реестру.
 * Права проверяет Moonraker: служба пересылает ему Authorization этого запроса.
 *
 * Provisioning (файлы в extensions/) — служба; enablement (mpu:v2:plugins) — как и раньше,
 * запись в settings текущего браузера.
 */

export interface RegistryPlugin {
  id: string;
  name: string;
  version: string;
  installedVersion: string | null;
  /** 'local' — установлен, но в реестре его нет. */
  state: 'available' | 'installed' | 'update' | 'local';
  description: string;
  /** Установлен из реестра. Папки, положенные вручную, служба не трогает. */
  managed: boolean;
  manifestUrl: string;
  /** Плагины, в точки которых он встраивается (без @core/*). Нет у старой службы. */
  requires?: string[];
  /** id → минимальная версия (null — любая), с @core/*. Нет у старой службы. */
  dependencies?: Record<string, string | null>;
  /** Версия контракта "MAJOR.MINOR" из реестра. Нет у старой службы и у 'local'. */
  pluginApi?: string;
}

interface ActionResult {
  id: string;
  changed: boolean;
  version: string | null;
  manifestUrl: string | null;
  /** Зависимости, поставленные вместе с плагином. */
  dependencies?: ActionResult[];
}

/** Служба ответила ошибкой: status и текст с сервера. */
export class InstallerError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'InstallerError';
  }
}

/** Ответил не наш JSON или никто (404/502 от nginx, HTML от dev-сервера, сеть). */
class ServiceUnavailableError extends Error {}

export interface ExtensionsInstallerDeps {
  /** Токен Moonraker этого хоста (см. findHostPrinter). */
  getToken: () => string | null;
  catalog: { refresh(): Promise<void> };
  settings: {
    plugins: Array<{ manifestUrl: string }>;
    addPlugin(manifestUrl: string, printerIds: string[], source: 'catalog', installedVersion?: string): unknown;
    removePlugin(manifestUrl: string): void;
  };
  loader: {
    loadEnabledPlugins(): Promise<void>;
    reloadRemotePlugin(manifestUrl: string): Promise<void>;
  };
  /** Для тестов. По умолчанию — глобальный fetch. */
  fetch?: typeof fetch;
}

export type ExtensionsInstaller = ReturnType<typeof createExtensionsInstaller>;

/**
 * Принтер, чей Moonraker обслуживает этот хост. Запись по умолчанию — http://<хост>:7125
 * (settings-store), поэтому главный признак — совпадение hostname, а не origin страницы.
 */
export function findHostPrinter<T extends { url: string }>(
  printers: readonly T[],
  location: { origin: string; hostname: string },
): T | null {
  const parse = (url: string): URL | null => {
    try {
      return new URL(url);
    } catch {
      return null;
    }
  };
  return (
    printers.find((p) => parse(p.url)?.origin === location.origin) ??
    printers.find((p) => parse(p.url)?.hostname === location.hostname) ??
    null
  );
}

export function createExtensionsInstaller(deps: ExtensionsInstallerDeps) {
  const { getToken, catalog, settings, loader } = deps;
  const doFetch = deps.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));

  let available = $state(false);
  let loading = $state(false);
  let plugins = $state<RegistryPlugin[]>([]);
  let registryError = $state<string | null>(null);
  /** id плагина, над которым идёт действие. Служба выполняет их по очереди. */
  let busyId = $state<string | null>(null);
  let error = $state<InstallerError | null>(null);

  async function call<T>(path: string, body?: { id: string }): Promise<T> {
    const headers: Record<string, string> = {};
    if (body) headers['Content-Type'] = 'application/json';
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;

    let res: Response;
    try {
      res = await doFetch(`/tessera-api/v1/${path}`, {
        method: body ? 'POST' : 'GET',
        headers,
        body: body ? JSON.stringify(body) : undefined,
        cache: 'no-store',
      });
    } catch {
      throw new ServiceUnavailableError();
    }

    let data: unknown = null;
    try {
      data = await res.json();
    } catch {
      // не JSON: разберёмся ниже
    }
    if (data === null || typeof data !== 'object') throw new ServiceUnavailableError();
    if (res.ok) return data as T;

    const message = (data as { error?: unknown }).error;
    if (typeof message !== 'string') throw new ServiceUnavailableError();
    throw new InstallerError(message, res.status);
  }

  async function reload(): Promise<void> {
    loading = true;
    try {
      const status = await call<{ plugins: RegistryPlugin[]; registryError: string | null }>('status');
      available = true;
      plugins = status.plugins;
      registryError = status.registryError;
    } catch (e) {
      if (e instanceof InstallerError) {
        // Служба есть, но отказала (например, 401): показать причину, а не прятать блок.
        available = true;
        plugins = [];
        registryError = null;
        error = e;
      } else {
        available = false;
        plugins = [];
      }
    } finally {
      loading = false;
    }
  }

  /** false — действие не удалось, причина в `error`. */
  async function run(id: string, action: () => Promise<void>): Promise<boolean> {
    if (busyId) return false;
    busyId = id;
    error = null;
    try {
      await action();
      return true;
    } catch (e) {
      error = e instanceof InstallerError ? e : new InstallerError(e instanceof Error ? e.message : String(e), 0);
      return false;
    } finally {
      // Каталог и реестр показывают то, что есть на диске, и после ошибки.
      await catalog.refresh();
      await reload();
      busyId = null;
    }
  }

  /**
   * Зависимости плагина для подтверждения установки: что служба поставит вместе
   * с ним (есть в реестре, не установлено), что обновит (установлено, но старше
   * manifest.dependencies) и чего нет нигде (вклады будут ждать).
   * Несовместимость с @core/* служба сообщит ошибкой установки.
   */
  function dependenciesOf(plugin: RegistryPlugin): {
    install: RegistryPlugin[];
    update: RegistryPlugin[];
    missing: string[];
  } {
    const byId = new Map(plugins.map((p) => [p.id, p]));
    const result = { install: [] as RegistryPlugin[], update: [] as RegistryPlugin[], missing: [] as string[] };
    const seen = new Set<string>([plugin.id]);
    const visit = (p: RegistryPlugin) => {
      for (const id of p.requires ?? []) {
        if (seen.has(id)) continue;
        seen.add(id);
        const dep = byId.get(id);
        if (!dep) {
          result.missing.push(id);
          continue;
        }
        visit(dep);
        const need = p.dependencies?.[id] ?? undefined;
        if (dep.state === 'available') result.install.push(dep);
        else if (dep.installedVersion && !satisfiesMin(dep.installedVersion, need) && satisfiesMin(dep.version, need)) {
          result.update.push(dep);
        }
      }
    };
    visit(plugin);
    return result;
  }

  /**
   * onReloadRequired — служба обновила уже включённую зависимость: её новый код
   * будет только после перезагрузки страницы (import() кэшируется по URL).
   */
  function install(plugin: RegistryPlugin, onReloadRequired?: () => void): Promise<boolean> {
    return run(plugin.id, async () => {
      const result = await call<ActionResult>('install', { id: plugin.id });
      // Включаем в этом браузере и зависимости: без них вклады плагина спят.
      const added = [...(result.dependencies ?? []), result].filter((r) => r.manifestUrl);
      if (added.length === 0) return;
      await catalog.refresh();
      const enabled = new Set(settings.plugins.map((p) => p.manifestUrl));
      for (const r of added) {
        const url = absoluteManifestUrl(r.manifestUrl!);
        if (enabled.has(url)) {
          // Зависимость уже была включена и служба её обновила (старше нужной версии).
          if (r !== result && r.changed) {
            await loader.reloadRemotePlugin(url);
            onReloadRequired?.();
          }
          continue;
        }
        // Как кнопка Install в каталоге: версия обязательна, иначе не появится update-available.
        settings.addPlugin(url, [], 'catalog', r.version ?? undefined);
      }
      await loader.loadEnabledPlugins();
    });
  }

  /** true — новый код получит только перезагрузка страницы: import() кэшируется по URL. */
  async function update(plugin: RegistryPlugin): Promise<boolean> {
    let reloadRequired = false;
    await run(plugin.id, async () => {
      const result = await call<ActionResult>('update', { id: plugin.id });
      if (!result.changed || !result.manifestUrl) return;
      await catalog.refresh();
      const url = absoluteManifestUrl(result.manifestUrl);
      // В этом браузере плагин могли и не включать: тогда перезагружать нечего.
      if (settings.plugins.some((p) => p.manifestUrl === url)) {
        await loader.reloadRemotePlugin(url);
        reloadRequired = true;
      }
    });
    return reloadRequired;
  }

  function remove(plugin: RegistryPlugin): Promise<boolean> {
    return run(plugin.id, async () => {
      // Сначала файлы: если служба откажет, в этом браузере ничего не изменится.
      await call<{ changed: boolean }>('remove', { id: plugin.id });
      settings.removePlugin(absoluteManifestUrl(plugin.manifestUrl));
      await loader.loadEnabledPlugins();
    });
  }

  return {
    get available() {
      return available;
    },
    get loading() {
      return loading;
    },
    get plugins() {
      return plugins;
    },
    get registryError() {
      return registryError;
    },
    get busyId() {
      return busyId;
    },
    get error() {
      return error;
    },
    /** Ошибка прошлого действия при этом забывается. */
    async refresh(): Promise<void> {
      error = null;
      await reload();
    },
    install,
    update,
    remove,
    dependenciesOf,
  };
}
