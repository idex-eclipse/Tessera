import { beforeEach, describe, expect, it, vi } from 'vitest';

// Каталог при импорте сразу читает /extensions/index.json: здесь нужен только URL-хелпер.
vi.mock('../extensions-catalog.svelte.ts', () => ({
  absoluteManifestUrl: (u: string) => `http://printer:8000${u}`,
}));

import {
  createExtensionsInstaller,
  findHostPrinter,
  type RegistryPlugin,
} from '../extensions-installer.svelte.ts';

const MANIFEST = '/extensions/hello/manifest.json';
const ABSOLUTE = `http://printer:8000${MANIFEST}`;

const plugin: RegistryPlugin = {
  id: 'acme/hello',
  name: 'Hello',
  version: '1.0.0',
  installedVersion: null,
  state: 'available',
  description: '',
  managed: false,
  manifestUrl: MANIFEST,
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function setup(respond: (path: string, init: RequestInit) => Response | Promise<Response>) {
  const order: string[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input).replace('/tessera-api/v1/', '');
    order.push(`api:${path}`);
    return respond(path, init ?? {});
  });
  const settings = {
    plugins: [] as Array<{ manifestUrl: string }>,
    addPlugin: vi.fn(() => order.push('settings:add')),
    removePlugin: vi.fn(() => order.push('settings:remove')),
  };
  const catalog = { refresh: vi.fn(async () => void order.push('catalog')) };
  const loader = {
    loadEnabledPlugins: vi.fn(async () => void order.push('loader:load')),
    reloadRemotePlugin: vi.fn(async () => void order.push('loader:reload')),
  };
  let token: string | null = null;
  const installer = createExtensionsInstaller({
    getToken: () => token,
    catalog,
    settings,
    loader,
    fetch: fetchMock as unknown as typeof fetch,
  });
  return {
    installer,
    settings,
    catalog,
    loader,
    fetchMock,
    order,
    setToken: (t: string | null) => {
      token = t;
    },
  };
}

const okStatus = () => json(200, { plugins: [plugin], registryError: null });
const okAction = (extra: object = {}) =>
  json(200, { id: plugin.id, changed: true, version: '1.0.0', manifestUrl: MANIFEST, ...extra });

describe('extensions-installer / availability', () => {
  it('служба ответила: блок доступен', async () => {
    const { installer } = setup(okStatus);
    await installer.refresh();
    expect(installer.available).toBe(true);
    expect(installer.plugins).toEqual([plugin]);
  });

  it.each([
    ['404 от nginx', () => new Response('<html>', { status: 404 })],
    ['502 без службы', () => new Response('<html>', { status: 502 })],
    ['HTML от dev-сервера', () => new Response('<!doctype html>', { status: 200 })],
    ['JSON без поля error', () => json(500, {})],
  ])('%s: блок скрыт', async (_name, respond) => {
    const { installer } = setup(respond);
    await installer.refresh();
    expect(installer.available).toBe(false);
    expect(installer.error).toBeNull();
  });

  it('сетевая ошибка: блок скрыт', async () => {
    const { installer } = setup(() => {
      throw new TypeError('network');
    });
    await installer.refresh();
    expect(installer.available).toBe(false);
  });

  it('401: служба есть, причина видна', async () => {
    const { installer } = setup(() => json(401, { error: 'Unauthorized: log in to this printer' }));
    await installer.refresh();
    expect(installer.available).toBe(true);
    expect(installer.plugins).toEqual([]);
    expect(installer.error?.status).toBe(401);
  });

  it('реестр недоступен: установленные всё равно показаны', async () => {
    const { installer } = setup(() => json(200, { plugins: [plugin], registryError: 'HTTP 500' }));
    await installer.refresh();
    expect(installer.registryError).toBe('HTTP 500');
    expect(installer.plugins).toHaveLength(1);
  });
});

describe('extensions-installer / requests', () => {
  it('токен уходит в Authorization, без токена заголовка нет', async () => {
    const { installer, fetchMock, setToken } = setup(okStatus);
    await installer.refresh();
    expect((fetchMock.mock.calls[0]![1]?.headers as Record<string, string>).Authorization).toBeUndefined();

    setToken('jwt');
    await installer.refresh();
    expect((fetchMock.mock.calls[1]![1]?.headers as Record<string, string>).Authorization).toBe('Bearer jwt');
  });

  it('действие передаёт JSON только с id', async () => {
    const { installer, fetchMock } = setup((path) => (path === 'status' ? okStatus() : okAction()));
    await installer.install(plugin);
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(JSON.parse(String(init?.body))).toEqual({ id: 'acme/hello' });
  });
});

describe('extensions-installer / install', () => {
  it('файлы → каталог → enablement → загрузка', async () => {
    const { installer, settings, order } = setup((path) => (path === 'status' ? okStatus() : okAction()));
    await expect(installer.install(plugin)).resolves.toBe(true);
    expect(order).toEqual(['api:install', 'catalog', 'settings:add', 'loader:load', 'catalog', 'api:status']);
    expect(settings.addPlugin).toHaveBeenCalledWith(ABSOLUTE, [], 'catalog', '1.0.0');
    expect(installer.busyId).toBeNull();
  });

  it('отказ службы: enablement не меняется, ошибка видна, каталог перечитан', async () => {
    const { installer, settings, loader, catalog } = setup((path) =>
      path === 'status' ? okStatus() : json(400, { error: 'sha256 mismatch' }),
    );
    await expect(installer.install(plugin)).resolves.toBe(false);
    expect(installer.error?.message).toBe('sha256 mismatch');
    expect(settings.addPlugin).not.toHaveBeenCalled();
    expect(loader.loadEnabledPlugins).not.toHaveBeenCalled();
    expect(catalog.refresh).toHaveBeenCalled();
    expect(installer.busyId).toBeNull();
  });

  it('второе действие во время первого не запускается', async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { installer, fetchMock } = setup(async (path) => {
      if (path === 'status') return okStatus();
      await gate;
      return okAction();
    });
    const first = installer.install(plugin);
    await expect(installer.install(plugin)).resolves.toBe(false);
    expect(installer.busyId).toBe(plugin.id);
    release();
    await first;
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('install'))).toHaveLength(1);
  });
});

describe('extensions-installer / update', () => {
  it('плагин включён в этом браузере: перезагрузка манифеста и плашка', async () => {
    const { installer, settings, loader } = setup((path) => (path === 'status' ? okStatus() : okAction()));
    settings.plugins = [{ manifestUrl: ABSOLUTE }];
    await expect(installer.update(plugin)).resolves.toBe(true);
    expect(loader.reloadRemotePlugin).toHaveBeenCalledWith(ABSOLUTE);
  });

  it('не включён в этом браузере: только файлы', async () => {
    const { installer, loader } = setup((path) => (path === 'status' ? okStatus() : okAction()));
    await expect(installer.update(plugin)).resolves.toBe(false);
    expect(loader.reloadRemotePlugin).not.toHaveBeenCalled();
  });

  it('версия не изменилась: перезагружать нечего', async () => {
    const { installer, settings, loader } = setup((path) =>
      path === 'status' ? okStatus() : okAction({ changed: false }),
    );
    settings.plugins = [{ manifestUrl: ABSOLUTE }];
    await expect(installer.update(plugin)).resolves.toBe(false);
    expect(loader.reloadRemotePlugin).not.toHaveBeenCalled();
  });
});

describe('extensions-installer / remove', () => {
  it('сначала файлы, затем enablement', async () => {
    const { installer, settings, order } = setup((path) =>
      path === 'status' ? okStatus() : json(200, { id: plugin.id, changed: true }),
    );
    await expect(installer.remove(plugin)).resolves.toBe(true);
    expect(order).toEqual(['api:remove', 'settings:remove', 'loader:load', 'catalog', 'api:status']);
    expect(settings.removePlugin).toHaveBeenCalledWith(ABSOLUTE);
  });

  it('отказ службы: запись в браузере остаётся', async () => {
    const { installer, settings } = setup((path) =>
      path === 'status' ? okStatus() : json(409, { error: 'installed manually' }),
    );
    await expect(installer.remove(plugin)).resolves.toBe(false);
    expect(settings.removePlugin).not.toHaveBeenCalled();
    expect(installer.error?.status).toBe(409);
  });
});

describe('findHostPrinter', () => {
  const location = { origin: 'http://printer:8000', hostname: 'printer' };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('запись по умолчанию: тот же hostname, порт Moonraker', () => {
    const local = { id: 'a', url: 'http://printer:7125' };
    expect(findHostPrinter([{ id: 'b', url: 'http://other:7125' }, local], location)).toBe(local);
  });

  it('совпадение origin важнее совпадения hostname', () => {
    const direct = { id: 'a', url: 'http://printer:7125' };
    const proxied = { id: 'b', url: 'http://printer:8000' };
    expect(findHostPrinter([direct, proxied], location)).toBe(proxied);
  });

  it('только чужие принтеры и битый URL: null', () => {
    expect(findHostPrinter([{ id: 'a', url: 'http://other:7125' }, { id: 'b', url: 'not a url' }], location)).toBeNull();
  });
});
